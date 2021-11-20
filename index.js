'use strict';

const tracker = require('./src/tracker');
const torrentParser = require('./src/torrent-parser');
const download = require('./src/download');
const torrent = torrentParser.open('./torrents/test.torrent');

download(torrent, torrent.info.name);

