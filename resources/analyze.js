const fs = require('fs');
const csv = require('csv-parser');
const { parse } = require('json2csv');

// Get the input file name from command-line arguments
const inputFile = process.argv[2];
const outputFile = 'output.csv';  // File indicating if all users agree
const summaryFile = 'summary.csv';  // File showing detailed picks

if (!inputFile) {
    console.error('Please provide the input CSV file as a command line argument.');
    process.exit(1);
}

const results = {};
const detailedResults = {};
let games = [];
const users = new Set();

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
            users.add(row['Email Address']);
        });
    })
    .on('end', () => {
        const output = [];
        const summary = [];

        games.forEach(game => {
            const teams = results[game] || [];
            const uniqueTeams = new Set(teams);
            const allAgree = [...uniqueTeams].some(team => teams.filter(t => t === team).length === 4);
            output.push({
                Game: game,
                AllUsersAgree: allAgree ? 'True' : 'False'
            });

            if (!allAgree) {
                for (const [team, userList] of Object.entries(detailedResults[game])) {
                    summary.push({
                        Game: game,
                        Team: team,
                        Users: userList.join(', ')
                    });
                }
            }
        });

        fs.writeFileSync(outputFile, parse(output));
        fs.writeFileSync(summaryFile, parse(summary));
        console.log('CSV files have been written to', outputFile, 'and', summaryFile);
    });
