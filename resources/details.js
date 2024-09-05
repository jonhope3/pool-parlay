const fs = require('fs');
const csv = require('csv-parser');
const { parse } = require('json2csv');

// Get the input file name from command-line arguments
const inputFile = process.argv[2];
const summaryFile = 'details.csv';  // File showing detailed picks

if (!inputFile) {
    console.error('Please provide the input CSV file as a command line argument.');
    process.exit(1);
}

const results = {};
const detailedResults = {};
let games = [];

fs.createReadStream(inputFile)
    .pipe(csv())
    .on('headers', (headers) => {
        games = headers.slice(2);  // Adjust if your columns differ
    })
    .on('data', (row) => {
        games.forEach(game => {
            if (!results[game]) {
                results[game] = [];
                detailedResults[game] = {};
            }
            results[game].push(row[game]);

            if (!detailedResults[game][row[game]]) {
                detailedResults[game][row[game]] = [];
            }
            detailedResults[game][row[game]].push(row['Email Address']);
        });
    })
    .on('end', () => {
        const summary = [];

        games.forEach(game => {
            for (const [team, userList] of Object.entries(detailedResults[game])) {
                summary.push({
                    Game: game,
                    Team: team,
                    Users: userList.join(', ')
                });
            }
        });

        fs.writeFileSync(summaryFile, parse(summary));
        console.log('Summary CSV file has been written to', summaryFile);
    });
