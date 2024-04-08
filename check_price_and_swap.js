const { getEthPrice } = require('./get_eth_price');
const { spawn } = require('child_process');
const fs = require('fs').promises;
require('dotenv').config();

const ath = parseFloat(process.env.ETH_ATH_PRICE); // Assurez-vous de définir cette valeur dans votre fichier .env
let isSwapInProgress = false; // Variable pour suivre si un swap est en cours
let swapExecuted = false;

async function checkSwapExecuted() {
    try {
        const filePath = './swapTransactionHash.txt'; // Assurez-vous que cela correspond au chemin du fichier où le hash est stocké
        const hash = await fs.readFile(filePath, 'utf8');
        if (hash) {
            console.log('Un hash de transaction a été trouvé, indiquant qu\'un swap a été exécuté.');
            return true;
        } else {
            console.log(`Ready to buy at $${parseFloat((ath * 0.77).toFixed(2))}`);
            return false;
        }
    } catch (error) {
        console.error(`Erreur lors de la lecture du fichier: ${error}`);
        return false; // Si le fichier ne peut pas être lu, considérez que le swap n'a pas été exécuté
    }
}

async function checkPriceAndSwap() {
    if (isSwapInProgress) {
        console.log('Un swap est déjà en cours, en attente de sa conclusion.');
        return;
    }
    // Arrêtez la vérification si le swap a déjà été exécuté
    swapExecuted = await checkSwapExecuted();

    if (swapExecuted) {
        console.log('Le swap a été exécuté avec succès, arrêt du script.');
        return;
    }

    try {
        const currentPrice = await getEthPrice();
        console.log(`Prix actuel de l'ETH: $${currentPrice}`);
        if (currentPrice <= ath * 0.77) { // Vérifie si le prix actuel est 22% plus bas que l'ATH
            console.log('Déclenchement de buy_swap.js...');
            isSwapInProgress = true; // Marquez qu'un swap est en cours

            const buySwap = spawn('node', ['buy_swap.js']);

            buySwap.stdout.on('data', (data) => {
                console.log(`stdout: ${data}`);
            });

            buySwap.stderr.on('data', (data) => {
                console.error(`stderr: ${data}`);
            });

            buySwap.on('close', (code) => {
                console.log(`Le processus buy_swap.js s'est terminé avec le code ${code}`);
                isSwapInProgress = false;
                checkSwapExecuted().then(swapExecutedAfter => {
                    if (swapExecutedAfter) {
                        console.log('Le swap a été exécuté avec succès.');
                    } else {
                        console.log('Le swap semble ne pas avoir été exécuté avec succès.');
                    }
                });
            });
        }
    } catch (error) {
        console.error('Erreur lors de la vérification du prix de l\'ETH:', error);
        isSwapInProgress = false; 
    }
}

const intervalId = setInterval(checkPriceAndSwap, 300000); // Gardez l'ID de l'intervalle pour pouvoir l'arrêter plus tard
// const intervalId = setInterval(checkPriceAndSwap, 30000); // Exécute `checkPriceAndSwap` toutes les 10

// Fonction pour vérifier périodiquement si le swap a été exécuté et arrêter l'intervalle
function stopCheckingIfSwapped() {
    if (swapExecuted) {
        clearInterval(intervalId);
        console.log('Arrêt de la vérification du prix de l\'ETH.');
    }
}

// Planifier la vérification de l'état du swap toutes les cinq minutes également
setInterval(stopCheckingIfSwapped, 300000);

// Lancer une première vérification immédiatement
checkPriceAndSwap();
