'use strict';
const tp = require('./torrent-parser.js');

module.exports = class {
    //两个二维数组，一个requested记录请求的情况，一个received请求接收的情况，已请求的块不再重复请求，提高效率，
    //received用于最后EndGame保证完整性
    constructor(torrent) {
        function buildPiecesArray(){
            const nPieces = torrent.info.pieces.length / 20 ; 
            const arr = new Array(nPieces).fill(null);
            return arr.map((_, i) => new Array(tp.blocksPerPiece(torrent, i)).fill(false));
        }

        this._requested = buildPiecesArray();
        this._received = buildPiecesArray();
        this._torrent = torrent;
        this.completedBlocks = 0;
        this._endGame = false;
        this.endGameQueue = [];
   }

   addRequested(pieceBlock){
    const blockIndex = pieceBlock.begin / tp.BLOCK_LEN;   
    this._requested[pieceBlock.index][blockIndex] = true;
   }

   addReceived(pieceBlock){
    this.completedBlocks++;
    const blockIndex = pieceBlock.begin / tp.BLOCK_LEN;   
    this._received[pieceBlock.index][blockIndex] = true;
   }

   needed(pieceBlock){
        /*如果不设计EndGame模式，仅在全部请求后将requested设置为received,若所有queue都已经跳过了某个请求失败的块，会缺失
          利用EndGame让空闲的socket重新请求缺失的块，能保证下载的完整性*/
       if(this._requested.every(block => block.every(i => i===true))){
           this._endGame = true;
           this._requested = this._received.map(blocks => blocks.slice());
           for(let i =0 ;i<this._received.length;i++) {
               for(let j =0;j<this._received[i].length;j++) {
                   if(!this._requested[i][j]) {
                       const pieceBlock= {
                           index: i,
                           begin: j * tp.BLOCK_LEN,
                           length: tp.blockLen(this._torrent, i, j)
                       };
                       this.endGameQueue.push(pieceBlock);
                   }
               }
           }
       }
       return !this._requested[pieceBlock.index][pieceBlock.begin / tp.BLOCK_LEN];
   }

   received(pieceBlock) {
       return this._received[pieceBlock.index][pieceBlock.begin/tp.BLOCK_LEN];
   }

   isDone(){
       return this._received.every(block => block.every(i => i === true));
   }

   isEndGame(){
        return this._endGame;
   }
};
