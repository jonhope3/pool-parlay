import fs from 'fs/promises';
import path from 'path';
import process from 'process';
import { authenticate } from '@google-cloud/local-auth';
import { google } from 'googleapis';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const seasonDataFile = '../season_data.json'; // Update this to the path of your JSON file
const selectedWeek = process.argv[2]; // Get the selected week from command line argument

// If modifying these scopes, delete token.json.
const SCOPES = ['https://www.googleapis.com/auth/forms.body'];
const TOKEN_PATH = path.join(process.cwd(), 'token.json');
const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');

/**
 * Reads previously authorized credentials from the save file.
 *
 * @return {Promise<OAuth2Client|null>}
 */
async function loadSavedCredentialsIfExist() {
    try {
        const content = await fs.readFile(TOKEN_PATH);
        const credentials = JSON.parse(content);
        return google.auth.fromJSON(credentials);
    } catch (err) {
        return null;
    }
}

/**
 * Serializes credentials to a file compatible with GoogleAuth.fromJSON.
 *
 * @param {OAuth2Client} client
 * @return {Promise<void>}
 */
async function saveCredentials(client) {
    const content = await fs.readFile(CREDENTIALS_PATH);
    const keys = JSON.parse(content);
    const key = keys.installed || keys.web;
    const payload = JSON.stringify({
        type: 'authorized_user',
        client_id: key.client_id,
        client_secret: key.client_secret,
        refresh_token: client.credentials.refresh_token,
    });
    await fs.writeFile(TOKEN_PATH, payload);
}

/**
 * Load or request or authorization to call APIs.
 *
 */
async function authorize() {
    let client = await loadSavedCredentialsIfExist();
    if (client) {
        return client;
    }
    client = await authenticate({
        scopes: SCOPES,
        keyfilePath: CREDENTIALS_PATH,
    });
    if (client.credentials) {
        await saveCredentials(client);
    }
    return client;
}

/**
 * Creates a Google Form for NFL game predictions for a specific week.
 * @param {google.auth.OAuth2} auth An authorized OAuth2 client.
 */
async function createForm(auth) {
    const forms = google.forms({ version: 'v1', auth });

    try {
        // Read the season data
        const data = JSON.parse(await fs.readFile(seasonDataFile, 'utf8'));
        const year = data.season;

        // Find the selected week
        const weekData = data.weeks.find(week => week.week.toString() === selectedWeek);

        if (!weekData) {
            console.error(`Week ${selectedWeek} not found in the data.`);
            return;
        }

        // Create a new form with the week number in the title
        const form = await forms.forms.create({
            requestBody: {
                info: {
                    title: `🎉 ${year} Week ${weekData.week} NFL Predictions 🎉`,
                },
            },
        });

        const formId = form.data.formId;

        // Update the form to add the description and questions
        const updateRequests = [
            {
                updateFormInfo: {
                    info: {
                        description: 'Pick which team you think will win each game.',
                    },
                    updateMask: 'description',
                },
            },
            ...weekData.games.map((game, index) => {
                return {
                    createItem: {
                        item: {
                            title: `${game.awayTeam.teamName} at ${game.homeTeam.teamName}`,
                            description: `Game Time: ${game.gameTime}`,
                            questionItem: {
                                question: {
                                    required: true,
                                    choiceQuestion: {
                                        type: 'RADIO',
                                        options: [
                                            { value: `${game.awayTeam.teamName}` },
                                            { value: `${game.homeTeam.teamName}` },
                                        ],
                                        shuffle: false,
                                    },
                                },
                            },
                        },
                        location: { index: index },
                    },
                };
            }),
        ];

        await forms.forms.batchUpdate({
            formId: formId,
            requestBody: {
                requests: updateRequests,
            },
        });

        console.log(`Form created successfully for Week ${weekData.week}. ID: ${formId}`);
        console.log(`You can view it at: https://docs.google.com/forms/d/${formId}/edit`);
    } catch (error) {
        console.error('Error creating form:', error);
    }
}

authorize().then(createForm).catch(console.error);