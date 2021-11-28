'use strict';
const tp = require('./torrent-parser.js');

module.exports = class {
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
