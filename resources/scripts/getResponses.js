import fs from 'fs';
import csv from 'csv-parser';

// Define file paths
const inputFile = process.argv[2];
const seasonDataFile = '../season_data.json';

if (!inputFile) {
    console.error('Please provide the input CSV file as a command line argument.');
    process.exit(1);
}

const results = {};
let games = [];

// Read the CSV file and process the data
fs.createReadStream(inputFile)
    .pipe(csv())
    .on('headers', (headers) => {
        games = headers.slice(2);  // Adjust if your columns differ
    })
    .on('data', (row) => {
        games.forEach(game => {
            if (!results[game]) {
                results[game] = [];
            }
            results[game].push(row[game]);
        });
    })
    .on('end', () => {
        // Read the existing season data
        const seasonData = JSON.parse(fs.readFileSync(seasonDataFile, 'utf-8'));

        // Process each game and determine consensus
        seasonData.weeks.forEach(week => {
            week.games.forEach(game => {
                const gameKey = `${game.homeTeam.teamName} @ ${game.awayTeam.teamName}`;
                if (results[gameKey]) {
                    const teamCounts = {};
                    let consensusTeam = '';

                    // Count occurrences of each team
                    results[gameKey].forEach(team => {
                        teamCounts[team] = (teamCounts[team] || 0) + 1;
                    });

                    // Find the team that all users agree on
                    for (const [team, count] of Object.entries(teamCounts)) {
                        if (count === results[gameKey].length) {
                            consensusTeam = team;
                            break;
                        }
                    }

                    // Update the consensus field if we have a consensus
                    if (consensusTeam) {
                        game.consensus = consensusTeam;
                    }
                }
            });
        });

        // Save the updated season data
        fs.writeFileSync(seasonDataFile, JSON.stringify(seasonData, null, 2));
        console.log('Updated season_data.json with consensus data.');
    });
