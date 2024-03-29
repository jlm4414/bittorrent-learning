'use strict';

const fs = require('fs');
const path = require('path');
const tp = require('./torrent-parser.js')

//单文件下载及多文件下载都支持
module.exports.initializeFiles = (torrent) => {
    fs.mkdir(('./' + torrent.info.name.toString('utf8')), 
  { recursive: true }, (err) => { 
    if (err) { 
      return console.error(err); 
    } 
    
  }); 
  
  var numFiles = tp.numFiles(torrent);

  if(numFiles-1){
      const files = [];
      var start = 0;
      
      torrent.info.files.forEach(item => {       
          const dict = {
              start : start,
              end : start + item.length - 1,
              file : fs.openSync('./' + (torrent.info.name.toString('utf8') + '/' + item.path.toString('utf8')), 'w'),
              length : item.length
          }
          start = start + item.length;
          files.push(dict);
      });

    return {
      files : files, 
      multiFile : true
    }; 
  }
  return {
    
    files : torrent.info.files ? fs.openSync('./' + (torrent.info.name.toString('utf8')) + '/' + (torrent.info.files[0].path.toString('utf8')) , 'w')
                              : fs.openSync('./' + (torrent.info.name.toString('utf8')) + '/' + (torrent.info.name.toString('utf8')), 'w'), 
    multiFile : false
  };
    
};

module.exports.chooseFile = (files, offset, blockEnd) => {
  
  for(let i = 0; i < files.length; i++){
    if(files[i].end >= offset){
      const temp = (files[i].end - offset + 1);
      const left = blockEnd - offset + 1;
      const carryForward = (temp < left );
      const length = (temp < left) ? temp : left;

      return {
        index : files[i].file,
        length : length,
        start : offset - files[i].start,
        carryForward : carryForward
      };
    }
  }
};

module.exports.closeFiles = (files) => {
  files.forEach(item => {
    try { fs.closeSync(item.file); } catch(e) {}
  })
};