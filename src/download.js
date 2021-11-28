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

let isMultiFile = true;
let done = false;
let doneEventEmitter;

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

    tracker.getPeers(torrent).then(peers => {
        const pieces = new Pieces(torrent);
        const fileDetails = fileHandler.initializeFiles(torrent);
        const files = fileDetails.files;
        isMultiFile = fileDetails.multiFile;
        doneEventEmitter = new events.EventEmitter();
        doneEventEmitter.setMaxListeners(peers.length);
        peers.forEach(peer => download(peer, torrent, pieces, files));
    }).catch(()=> {console.log('\n'+'连接tracker服务器失败,无法完成比特下载');b1.stop();});
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
        //console.log(msg.toString('utf8'));
        const m = message.parse(msg);
        //console.log(m.id);

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
    while(pieces.isEndGame()&&pieces.endGameQueue.length>0) {
        const pieceBlock = pieces.endGameQueue[0];
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

    if(pieces.isEndGame()&&pieces.received(payload))
    {
        return;
    }

    pieces.addReceived(payload); //wouldnt this be a relatively large object to pass??

    b1.increment({speed : getSpeed(pieces)});

    let offset = payload.index*torrent.info['piece length'] + payload.begin;  
    //console.log(files) 

    if(isMultiFile) {

        let blockEnd = offset + payload.block.length - 1;
        let fileDetails = fileHandler.chooseFile(files, offset, blockEnd);
        let start = 0;
        fs.write(fileDetails.index, payload.block.slice(start, start + fileDetails.length), 0, fileDetails.length, fileDetails.start, () => {});
       // console.log(fileDetails);  

        while(fileDetails.carryForward){
            start += fileDetails.length;
            offset += fileDetails.length;
            fileDetails = fileHandler.chooseFile(files, offset, blockEnd);        
            fs.write(fileDetails.index, payload.block.slice(start, start + fileDetails.length), 0, fileDetails.length, fileDetails.start, () => {});

        }  
    }
    
    else fs.write(files, payload.block, 0, payload.block.length, offset, () => {});
    
    
    if(pieces.isDone()&&!done){
        done = true;
        doneEventEmitter.emit('done');
        b1.stop();
        console.log("DONE!");
        fileHandler.closeFiles(files);
    }
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
    const dSpeed = Math.floor((1000*(newCount - lastCount)) / (newTime - lastTime));
    return dSpeed;       
}
