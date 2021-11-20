'use strict';


const BN = require('bn.js');
const crypto = require('crypto')
const fs = require('fs');
const bencode = require('bencode');

module.exports.numFiles = (torrent) => {
    return torrent.info.files ? torrent.info.files.length : 1;
};

module.exports.open = (filepath) => {
    return bencode.decode(fs.readFileSync(filepath));
};

module.exports.infoHash = (torrent) => {
    const info = bencode.encode(torrent.info);
    return crypto.createHash('sha1').update(info).digest();
};

module.exports.size = (torrent) => { 

    const size = torrent.info.files ?
    torrent.info.files.map(file => file.length).reduce((a, b) => a + b) : torrent.info.length;
    
    return new BN(size).toBuffer('be',8);

};

module.exports.BLOCK_LEN = Math.pow(2, 14); 

module.exports.pieceLen = (torrent, pieceIndex) => {  
    const totalLength = new BN(this.size(torrent)).toNumber();
    const pieceLength = torrent.info['piece length'];

    const lastPieceLength = totalLength % pieceLength;
    const lastPieceIndex = Math.floor(totalLength / pieceLength);

    return (pieceIndex === lastPieceIndex) ? lastPieceLength : pieceLength;
};

module.exports.blocksPerPiece = (torrent, pieceIndex) => { 
    return Math.ceil(this.pieceLen(torrent, pieceIndex) / this.BLOCK_LEN);
};

module.exports.blockLen = (torrent, pieceIndex, blockIndex) => { 
    const pieceLength = this.pieceLen(torrent, pieceIndex);
  
    const lastBlockLength = pieceLength % this.BLOCK_LEN;
    const lastBlockIndex = Math.floor(pieceLength / this.BLOCK_LEN);

    return blockIndex === lastBlockIndex ? lastBlockLength : this.BLOCK_LEN;
  };

module.exports.totalBlocks = (torrent) => {
    const totalLength = new BN(this.size(torrent)).toNumber();
    return Math.ceil(totalLength / this.BLOCK_LEN);
}