'use strict';

const dgram = require('dgram');
const Buffer = require('buffer').Buffer;
const urlParse = require('url').parse;
const crypto = require('crypto');
const util = require('./util');
const events = require('events');
const torrentParser = require('./torrent-parser.js')

module.exports.getPeers = (torrent) => {
    //以Promise实现异步操作，连接失败则整个下载退出，连接成功则根据Peer List进行下载
    return new Promise(function (resolve, reject){
        const socket = dgram.createSocket('udp4');
        const url = torrent["announce-list"][1].toString('utf8');

        //连接相关的eventEmitter，用于监控connect状态变化
        let connectEventEmitter = new events.EventEmitter();
        //8次连接失败后，退出
        connectEventEmitter.addListener('connect failed',function (){socket.close();reject();});

        sendConn(socket,url,0,connectEventEmitter);

        socket.on('message', response => {

            if (respType(response) === 'connect'){
                connectEventEmitter.emit('connected');
                const connResp = parseConnResp(response);

                const announceReq = buildAnnounceReq(connResp.connectionId, torrent);
                udpSend(socket, announceReq, url);
            }

            else if (respType(response) === 'announce'){

                const announceResp = parseAnnounceResp(response);

                resolve(announceResp.peers);

                socket.close();
            }
        });
    });
};

function respType(resp){
    const action = resp.readUInt32BE(0);
    if(action===1) return 'announce';
    if(action===0) return 'connect';
}

function udpSend(socket, message, rawUrl, callback = ()=>{}) {
    const url = urlParse(rawUrl);
    socket.send(message, 0, message.length, url.port, url.hostname, callback);    
}

/*实现connect重连，根据BitTorrent Protocol最多8次连接请求*/
function sendConn(socket,url,n,connectEventEmitter)
{
    udpSend(socket,buildConnReq(),url);
    if(n < 7)
    {
        /*利用setTimeout实现定时重传，eventEmitter保证连接成功后结束重传*/
        let stopFunc = function (){clearTimeout(timeoutID)}
        let timeoutID = setTimeout(function (){sendConn(socket,url,n+1,connectEventEmitter);connectEventEmitter.removeListener('connected',stopFunc)},Math.pow(2,n)*15*1000);
        connectEventEmitter.addListener('connected',stopFunc)
    }
    else
    {
        /*连接超过8次，eventEmitter发送连接失败*/
        connectEventEmitter.emit('connect failed');
    }
}

function buildConnReq() {
    const buf = Buffer.allocUnsafe(16);

    buf.writeUInt32BE(0x417,0);
    buf.writeUInt32BE(0x27101980,4);
    buf.writeUInt32BE(0,8);
    crypto.randomBytes(4).copy(buf,12);

    return buf;
}

function parseConnResp(resp){
    
    return {
        action : resp.readUInt32BE(0),
        transactionId : resp.readUInt32BE(4),
        connectionId : resp.slice(8)
    }
}

function buildAnnounceReq(connId, torrent, port=6881){

    const buf = Buffer.allocUnsafe(98);

    connId.copy(buf, 0);

    buf.writeUInt32BE(1, 8);

    crypto.randomBytes(4).copy(buf,12);

    torrentParser.infoHash(torrent).copy(buf, 16); 

    util.genId().copy(buf, 36); 

    Buffer.alloc(8).copy(buf, 56); 

    torrentParser.size(torrent).copy(buf, 64); //??????????????????

    Buffer.alloc(8).copy(buf, 72);

    buf.writeUInt32BE(0,80);

    buf.writeUInt32BE(0,84);

    crypto.randomBytes(4).copy(buf,88);

    buf.writeInt32BE(-1,92);

    buf.writeUInt16BE(port,96);

    return buf;

}

function parseAnnounceResp(resp) {

    /*用于将连续的peer信息切片成peer list*/
    function group(iterable, groupSize) {
        let groups = [];
        for(let i = 0; i < iterable.length; i += groupSize){
            groups.push(iterable.slice(i, i + groupSize));
        }
        return groups;
    }


    return{
        action : resp.readUInt32BE(0),
        transactionId : resp.readUInt32BE(4),
        interval : resp.readUInt32BE(8),
        leechers : resp.readUInt32BE(12),
        seeders : resp.readUInt32BE(16),
        peers : group(resp.slice(20), 6).map(address => {
            return{
                ip : address.slice(0,4).join('.'),
                port : address.readUInt16BE(4)
            }
        })
    }
}
