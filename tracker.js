'use strict'

const dgram = require('dgram');
const Buffer = require('buffer').Buffer;
const urlParse = require('url').parse;
const crypto = require('crypto')
const bignum = require('bignum')

module.exports.getPeers = (torrent,callback)=>{
    const socket = dgram.createSocket('udp4');
    const url = torrent.announce.toString('utf8');

    udpSend(socket,buildConnReq(),url);

    socket.on('message',response=>{
        if(respType(response)==='connect'){
            const connResp = parseConnResp(response);
            const announceReq = buildAnnounceReq(connResp.connectionId);
            udpSend(socket, announceReq, url);
        }
        else if(respType(response)==='announce'){
            const announceResp = parseAnnounceResp();
            callback(announceResp.peers);
        }
    })
}

function udpSend(socket, message, rawUrl, callback=()=>{}) {
    const url = urlParse(rawUrl);
    socket.send(message, 0, message.length, url.port, url.host, callback);
}

function respType(resp) {

}

//用于构建connect请求
function buildConnReq() {
    const buf = Buffer.alloc(16);

    //BE和LE代表的大小端，offset的最大要由写入的字节数确定，此处根据protocol写入connection id
    buf.writeUInt32BE(0x417,0);
    buf.writeUInt32BE(0x27101980, 4);

    //根据protocol，action为0
    buf.writeUInt32BE(0,8);

    //transaction为一个4字节的随机数
    crypto.randomBytes(4).copy(buf,12);

    return buf;
}

//用于解析connect的response
function parseConnResp(resp) {
    return {
        action:resp.readUInt32BE(0),
        transactionId:resp.readUInt32BE(4),
        connectionId:resp.slice(8)
    }
}

//用于构建announce请求
function buildAnnounceReq(connId) {

}

function parseAnnounceResp(resp) {
    // ...
}