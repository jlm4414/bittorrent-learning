'use strict';

const net = require('net');
const tracker = require('./tracker.js');
const Buffer = require('buffer').Buffer;
const message = require('./message.js');
const Pieces = require('./Pieces.js');
const Queue = require('./Queue.js');
const fs = require('fs');
const tp = require('./torrent-parser.js');
const cliProgress = require('cli-progress');
const fileHandler = require('./fileHandler');
const events = require("events");
const speed = {
    timer : 0,
    count : 0
};

let isMultiFile;
let done;
let doneEventEmitter;

//可视化进度条
const b1 = new cliProgress.SingleBar({
    format: 'CLI Progress |' + '{bar}' + '| {percentage}% || {value}/{total} Chunks || Speed: {speed} || ETA: {eta_formatted}',
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
    hideCursor: true
});

module.exports = (torrent, path) => {   

    b1.start(tp.totalBlocks(torrent), 0, {
        speed: "N/A"
    });

    //promise的结构进行异步操作，根据能否获取Peer List决定下一步，成功则建立多个连接下载，失败则提示并退出
    tracker.getPeers(torrent).then(peers => {
        const pieces = new Pieces(torrent);
        const fileDetails = fileHandler.initializeFiles(torrent);
        const files = fileDetails.files;
        isMultiFile = fileDetails.multiFile;
        doneEventEmitter = new events.EventEmitter();
        doneEventEmitter.setMaxListeners(peers.length);
        done = false;
        peers.forEach(peer => download(peer, torrent, pieces, files));
    }).catch(()=> {b1.stop();console.log('连接tracker服务器失败,无法完成比特下载');});
};

function download(peer, torrent, pieces, files) {
    const socket = new net.Socket();
    socket.on('error', ()=>{});
    socket.connect(peer.port, peer.ip, () => {
        socket.write(message.buildHandshake(torrent));
    });

    doneEventEmitter.addListener('done',function (){socket.end();});

    const queue = new Queue(torrent);
    onWholeMsg(socket, msg => msgHandler(msg, socket, pieces, queue, torrent, files));      

}

function msgHandler(msg, socket, pieces, queue, torrent, files){
    if(isHandshake(msg)) socket.write(message.buildInterested());
    
    else {
        const m = message.parse(msg);

        if (m.id === 0) chokeHandler(socket);
        if (m.id === 1) unchokeHandler(socket, pieces, queue);
        if (m.id === 4) haveHandler(socket, m.payload, pieces, queue);
        if (m.id === 5) bitfieldHandler(socket, m.payload, pieces, queue);
        if (m.id === 7) pieceHandler(socket, m.payload, pieces, queue, torrent, files);
    }
}

function isHandshake(msg){
    return (msg.length === msg.readUInt8(0) + 49 && msg.toString('utf8',1, 1 + msg.readUInt8(0)) === 'BitTorrent protocol');
}

//TCP传递不一定是完整的一条消息，需要确保接受的数据已经包含一条完整的消息，再进行处理
function onWholeMsg(socket, callback) {
    let savedBuff = Buffer.alloc(0);
    let Handshake = true;

    socket.on('data', recvdBuffer => {
        const msgLen = () => Handshake ? savedBuff.readUInt8(0) + 49 : savedBuff.readInt32BE(0) + 4; //changes Uint to int
        savedBuff = Buffer.concat([savedBuff, recvdBuffer]);

        while(savedBuff.length >=4 && savedBuff.length >= msgLen()) {
            callback(savedBuff.slice(0,msgLen()));
            savedBuff = savedBuff.slice(msgLen());
            Handshake = false;
        }

    });
    
}

function chokeHandler(socket) {
    socket.end();
}

function haveHandler (socket, payload, pieces, queue) {
    const pieceIndex = payload.readUInt32BE(0);
    const queueEmpty = (queue.length === 0);
        
    queue.queue(pieceIndex);
    if(queueEmpty) requestPiece(socket,pieces,queue);
}

function bitfieldHandler (socket, payload, pieces, queue){
    const queueEmpty = (queue.length === 0);
    payload.forEach((byte, i) => {
        for(let j = 0; j < 8; j++){
            if(byte % 2) queue.queue(8*i + 7 - j);
            byte = Math.floor(byte / 2);
        }        
    });

    if(queueEmpty) requestPiece(socket, pieces, queue);
}

function unchokeHandler(socket, pieces, queue) {
    queue.choked = false;    
    requestPiece(socket, pieces, queue);
}

function requestPiece(socket, pieces, queue){

    if(queue.choked) return null;

    while(queue.length()){
        const pieceBlock = queue.dequeue();
        if(pieces.needed(pieceBlock)){
            socket.write(message.buildRequest(pieceBlock));
            pieces.addRequested(pieceBlock);
            break;
        }
    }
    //EndGame模式下，空闲的socket请求缺失的块
    while(pieces.isEndGame()&&pieces.endGameQueue.length>0) {
        const pieceBlock = pieces.endGameQueue[0];
        //若已经请求并接收到了队首的块，则将其移除，请求下一个块
        if(pieces.received(pieceBlock)) {
            pieces.endGameQueue.shift();
        }
        else{
            socket.write(message.buildRequest(pieceBlock));
            break;
        }
    }
}

function pieceHandler(socket, payload, pieces, queue, torrent, files){

    //因为EndGame会有多个空闲socket请求相同的块，防止重复的写
    if(pieces.isEndGame()&&pieces.received(payload))
    {
        return;
    }

    pieces.addReceived(payload);

    b1.increment({speed : getSpeed(pieces)});

    let offset = payload.index*torrent.info['piece length'] + payload.begin;

    if(isMultiFile) {

        let blockEnd = offset + payload.block.length - 1;
        let fileDetails = fileHandler.chooseFile(files, offset, blockEnd);
        let start = 0;
        fs.write(fileDetails.index, payload.block.slice(start, start + fileDetails.length), 0, fileDetails.length, fileDetails.start, () => {});

        //多个文件时，接收到的数据可能不仅仅是一个文件的数据，需要对对应的多个文件进行写
        while(fileDetails.carryForward){
            start += fileDetails.length;
            offset += fileDetails.length;
            fileDetails = fileHandler.chooseFile(files, offset, blockEnd);        
            fs.write(fileDetails.index, payload.block.slice(start, start + fileDetails.length), 0, fileDetails.length, fileDetails.start, () => {});

        }  
    }
    
    else fs.write(files, payload.block, 0, payload.block.length, offset, () => {});
    
    //所有块接受后，退出并将状态置为done，防止异步导致的多次终止
    if(!done&&pieces.isDone()){
        done = true;
        doneEventEmitter.emit('done');
        b1.stop();
        console.log("DONE!");
        fileHandler.closeFiles(files);
    }
    //未完成则请求下一块
    else{
        requestPiece(socket, pieces, queue);
    }

}

function getSpeed(pieces){
    const lastTime = speed.timer;
    const lastCount = speed.count;
    const newTime = (new Date()).getTime();
    const newCount = pieces.completedBlocks;
    speed.count = newCount;
    speed.timer = newTime;
    return Math.floor((1000*(newCount - lastCount)) / (newTime - lastTime));
}
