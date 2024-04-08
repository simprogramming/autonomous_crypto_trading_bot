// libraries import
const { Web3 } = require('web3');
const { abi } = require('@openzeppelin/contracts/build/contracts/ERC20.json');
const fetch = require("node-fetch");
// const yesno = require("yesno");
const BN = require('bn.js');
const fs = require('fs').promises;

require('dotenv').config(); 

// blockchain information
const chainId = 137; // Chain ID for Polygon (Matic)
const web3RpcUrl = process.env.RPC_URL; // URL for Polygon (Matic) node
const web3 = new Web3(web3RpcUrl);
const walletAddress = process.env.WALLET_ADDRESS; // Your wallet address
const privateKey = process.env.PRIVATE_KEY;
const spenderAddress = process.env.SPENDER_ADDRESS; // Adresse du contrat 1inch


// APIs
const api_key = process.env.INCH_API_KEY;
const broadcastApiUrl = `https://api.1inch.dev/tx-gateway/v1.1/${chainId}/broadcast`;
const apiBaseUrl = `https://api.1inch.dev/swap/v6.0/${chainId}`;
const headers = { headers: { Authorization: api_key, accept: "application/json" } };

// Construct full API request URL
function apiRequestUrl(methodName, queryParams) {
    return apiBaseUrl + methodName + "?" + new URLSearchParams(queryParams).toString();
}

// transaction information
const swapParams = {
    src: process.env.USDC_TOKEN_ADDRESS, // Token address of USDC
    dst: process.env.WETH_TOKEN_ADDRESS, // Token address of WETH
    amount: "1000000", // 1$ Montant à échanger (en wei)
    // amount: "100000000" -> 100$ USDC
    from: walletAddress,
    slippage: 1, // Maximum acceptable slippage percentage for the swap (e.g., 1 for 1%)
    disableEstimate: false, // Set to true to disable estimation of swap details
    allowPartialFill: false // Set to true to allow partial filling of the swap order
};

function delay(time) {
    return new Promise(resolve => setTimeout(resolve, time));
};

// Vérifiez le solde de MATIC de votre portefeuille
async function checkMaticBalance(address) {
    try {
        const balanceWei = await web3.eth.getBalance(address); // Obtenir le solde de l'adresse en wei
        const balanceMatic = web3.utils.fromWei(balanceWei, 'ether'); // Convertir le solde en MATIC
        console.log(`Le solde du portefeuille est de ${balanceMatic} MATIC.`);
    } catch (error) {
        console.error(`Une erreur est survenue lors de la vérification du solde : ${error.message}`);
    }
}

// Check USDC balance of USDC token
async function checkTokenBalance(tokenAddress, ownerAddress) {
    const tokenContract = new web3.eth.Contract(abi, tokenAddress);
    const balance = await tokenContract.methods.balanceOf(ownerAddress).call();
    return balance;
}

// Set allowance
async function setAllowance(tokenContractAddress, spenderAddress, amount) {
    const tokenContract = new web3.eth.Contract(abi, tokenContractAddress);
    const tx = tokenContract.methods.approve(spenderAddress, amount);
    const gas = await tx.estimateGas({from: walletAddress});
    const gasPrice = await web3.eth.getGasPrice();
    const data = tx.encodeABI();
    const nonce = await web3.eth.getTransactionCount(walletAddress);

    const txData = {
        from: walletAddress,
        to: tokenContractAddress,
        data,
        gas,
        gasPrice,
        nonce,
    };

    const signedTx = await web3.eth.accounts.signTransaction(txData, privateKey);
    return web3.eth.sendSignedTransaction(signedTx.rawTransaction);
}

// Check token allowance
async function checkAllowance(tokenAddress, ownerAddress, spenderAddress) {
    const erc20ABI = [{"constant":true,"inputs":[{"name":"_owner","type":"address"},{"name":"_spender","type":"address"}],"name":"allowance","outputs":[{"name":"remaining","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"}];
    const contract = new web3.eth.Contract(erc20ABI, tokenAddress);
    const allowance = await contract.methods.allowance(ownerAddress, spenderAddress).call();
    return allowance;
}

// Post raw transaction to the API and return transaction hash
async function broadCastRawTransaction(rawTransaction) {
    try {
        const response = await fetch(broadcastApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: api_key },
            body: JSON.stringify({ rawTransaction })
        });

        // Vérifiez d'abord le statut de la réponse
        if (!response.ok) {
            // Si la réponse n'est pas 200, récupérez le texte pour le débogage
            const errorText = await response.text();
            console.error('Erreur lors de la requête à l\'API:', errorText);
            throw new Error('La requête à l\'API a échoué avec le statut ' + response.status);
        }

        // Ensuite, traitez la réponse comme JSON
        const data = await response.json();
        return data; // ou traitez les données comme nécessaire
    } catch (error) {
        console.error('Erreur lors de l\'envoi de la transaction:', error);
        throw error; // Propagez l'erreur ou gérez-la comme vous le souhaitez
    }
}


// Sign and post a transaction, return its hash
async function signAndSendTransaction(transaction) {
    if (!transaction) { throw new Error("Transaction object is undefined.");}
    if (!transaction.from) { transaction.from = walletAddress;}
    if (!transaction.nonce) {
        transaction.nonce = await web3.eth.getTransactionCount(walletAddress, 'latest');
        transaction.nonce = web3.utils.toHex(transaction.nonce); // Convertir en hexadécimal
    }
    const { rawTransaction } = await web3.eth.accounts.signTransaction(transaction, privateKey);

    return await broadCastRawTransaction(rawTransaction);
}

// Approve transaction
async function buildTxForApproveTradeWithRouter(tokenAddress, amount) {
    const url = apiRequestUrl("/approve/transaction", amount ? { tokenAddress, amount } : { tokenAddress });

    const transaction = await fetch(url, headers).then((res) => res.json());

    const gasLimit = await web3.eth.estimateGas({
        ...transaction,
        from: walletAddress
    });

    return {...transaction, gas: web3.utils.toHex(gasLimit)};
}

// Confirm and send the transaction
async function buildTxForSwap(swapParams) {
    const url = apiRequestUrl("/swap", swapParams);

    // Fetch the swap transaction details from the API
    return fetch(url, headers).then((res) => res.json()).then((res) => res.tx);
}


async function main() {
    console.log("Démarrage du script d'échange de tokens...");

    await checkMaticBalance(walletAddress);

    const usdcBalance = await checkTokenBalance(swapParams.src, walletAddress);
    console.log(`USDC Balance: ${web3.utils.fromWei(usdcBalance, 'mwei')} USDC`); // 'mwei' since USDC has 6 decimals

    if (web3.utils.fromWei(usdcBalance, 'mwei') < 1) {
        console.log('Not enough USDC for this transaction');
        return;
    }

    // Vérification du solde de MATIC pour s'assurer qu'il y a suffisamment de fonds pour le gas
    const maticBalance = await web3.eth.getBalance(walletAddress);
    if (new BN(maticBalance).lt(new BN(swapParams.amount))) {
        console.log("Fonds insuffisants pour l'échange.");
        return;
    }

    await delay(1000);

    // Vérification de l'allowance pour le token
    const allowance = await checkAllowance(swapParams.src, walletAddress, spenderAddress);
    console.log(`Allowance actuelle: ${allowance}`);

    // // Si l'allowance est insuffisante, augmentez-la
    if (new BN(allowance).lt(new BN(swapParams.amount))) {
        console.log("L'allowance du token est insuffisante pour l'échange. Obtention de l'approbation...");
        const approvalResult = await setAllowance(swapParams.src, spenderAddress, swapParams.amount);
        console.log("Résultat de la transaction d'approbation : ", approvalResult);
    } else {
        console.log("L'allowance du token est suffisante pour l'échange.");
    }

     // Préparation de la transaction pour l'échange après s'être assuré que l'allowance est suffisante
    const transactionForSign = await buildTxForApproveTradeWithRouter(swapParams.src, swapParams.amount);
    console.log("Transaction for approval: ", transactionForSign);

    const ok = !!transactionForSign;

    if (ok) {
        await delay(1000);
        const approveTxHash = await signAndSendTransaction(transactionForSign);
        console.log("Approval transaction hash: ", approveTxHash);
    } else {
        console.log("User declined the transaction.");
        return; // Exit if user does not confirm
    }

      
    await delay(1000);
    const swapTransaction = await buildTxForSwap(swapParams);
    
    if (!swapTransaction) {
        console.error("Failed to obtain swap transaction details.");
        return; // Exit if the transaction details couldn't be fetched
    }
    
    console.log("Transaction for swap:", swapTransaction);

    const confirmSwap = !!swapTransaction;

    if (confirmSwap) {
        try {
            await delay(3000);
            const swapTxHash = await signAndSendTransaction(swapTransaction);
            console.log(`Échange réussi. Hash de la transaction :`, swapTxHash);
            const filePath = './swapTransactionHash.txt'; // Chemin du fichier où vous souhaitez enregistrer le hash
            fs.writeFile(filePath, swapTxHash.transactionHash, (err) => {
                if (err) throw err;
                console.log(`Le hash de la transaction a été enregistré avec succès dans ${filePath}`);
            });
        } catch (error) {
            console.error("Échec de l'échange : ", error);
        }
    } else {
        console.log("L'échange a été annulé par l'utilisateur.");
    }
}

main().catch(console.error);