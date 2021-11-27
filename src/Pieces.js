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
        this.completedBlocks = 0;
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
           this._requested = this._received.map(blocks => blocks.slice());
       }

       return !this._requested[pieceBlock.index][pieceBlock.begin / tp.BLOCK_LEN];
   }

   isDone(){
       return this._received.every(block => block.every(i => i === true));
   }

   /*
   progress(torrent){
       const total = tp.totalBlocks(torrent);
       const percentage = Math.round(((this._completedBlocks * 100 / total) + Number.EPSILON) * 100) / 100
       process.stdout.write('progress: ' + percentage + '%\r');
   }
   */
   
};
