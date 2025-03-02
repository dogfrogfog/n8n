const fs = require('fs');
const path = require('path');

const directoryPath = '/n8n-data';

fs.readdir(directoryPath, (err, files) => {
    if (err) {
        console.log('Error reading directory:', err);
        return;
    }

    files.forEach(file => {
        console.log(file);
    });
});
