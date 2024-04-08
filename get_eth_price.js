const fetch = require('node-fetch');
require('dotenv').config();

async function getEthPrice() {
    const url = 'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd';
    const options = {
        method: 'GET',
        headers: {
            'x-cg-demo-api-key': process.env.COIN_GECKO_API_KEY, // Utilisez votre propre nom de variable d'environnement
            accept: 'application/json',
        },
    };

    try {
        const response = await fetch(url, options);
        const data = await response.json();
        return data.ethereum.usd; // Retourne le prix actuel de l'ETH
    } catch (err) {
        console.error('Erreur lors de la récupération du prix de l\'ETH:', err);
    }
}

module.exports = { getEthPrice };
