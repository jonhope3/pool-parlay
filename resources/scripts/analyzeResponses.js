import fs from 'fs';
import csv from 'csv-parser'

// Get the input file name from command-line arguments
const inputFile = process.argv[2];
const outputFile = 'output.json';  // File indicating if all users agree
const summaryFile = 'summary.json';  // File showing detailed picks

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
            const teamCounts = {};
            let allAgreeTeam = '';

            // Count occurrences of each team
            teams.forEach(team => {
                teamCounts[team] = (teamCounts[team] || 0) + 1;
            });

            // Find the team that all users agree on
            for (const [team, count] of Object.entries(teamCounts)) {
                if (count === users.size) {
                    allAgreeTeam = team;
                    break;
                }
            }

            const uniqueTeams = new Set(teams);
            const allAgree = allAgreeTeam !== '';
            output.push({
                Game: game,
                AllUsersAgree: allAgree ? 'True' : 'False',
                AgreedTeam: allAgreeTeam || 'None'
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

        fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));
        fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2));
        console.log('JSON files have been written to', outputFile, 'and', summaryFile);
    });
