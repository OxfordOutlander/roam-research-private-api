require('dotenv').config(); // This line loads the .env file content into process.env
const RoamPrivateApi = require('./RoamPrivateApi'); // Adjust the path if necessary

// Use environment variables for your Roam Research credentials and graph name
const graphName = process.env.ROAM_API_GRAPH;
const email = process.env.ROAM_API_EMAIL;
const password = process.env.ROAM_API_PASSWORD;

async function searchRoam(queryText) {
  const roamApi = new RoamPrivateApi(graphName, email, password);
  
  try {
    await roamApi.logIn();
    const searchQuery = roamApi.getQueryToFindBlocks(queryText);
    const searchResults = await roamApi.runQuery(searchQuery);
    
    console.log('Search Results:', searchResults);
  } catch (error) {
    console.error('Error performing search:', error);
  } finally {
    await roamApi.close();
  }
}

// Replace "example search text" with your actual search text
searchRoam("Potato");
