// noinspection JSUnfilteredForInLoop

const maxUTXOs=100;
const syncIfIdell=300000;  //5min
const syncIntervalsIfNotUsed=6;
const changeAddressLabel="temp_change";

const config=require('./config');
const DigiByte=require('digibyte-rpc');
const stream=require('./stream');
const screen=require('./screen');

/**
 * Converts a sat int to string decimal
 * @param {int|BigInt} value
 * @param {int} decimals
 * @return {string}
 */
module.exports.satToDecimal=(value,decimals)=>{
    let str=value.toString();
    if (decimals===0) return str;
    str=str.padStart(decimals+1,"0");
    let periodPoint=str.length-decimals;
    return str.substr(0,periodPoint)+'.'+str.substr(periodPoint);
}

/**
 * Converts Strings to BigInts
 * @param {UTXO[]}    utxos
 * @return {UTXO[]}
 */
const convertUtxoStrings=(utxos)=>{
    for (let utxo of utxos) {
        utxo.value=BigInt(utxo.value);
        if (utxo.assets===undefined) continue;
        for (let asset of utxo.assets) asset.amount=BigInt(asset.amount);
    }
    return utxos;
}


/*_____       _             __
 |_   _|     | |           / _|
   | |  _ __ | |_ ___ _ __| |_ __ _  ___ ___
   | | | '_ \| __/ _ \ '__|  _/ _` |/ __/ _ \
  _| |_| | | | ||  __/ |  | || (_| | (_|  __/
 |_____|_| |_|\__\___|_|  |_| \__,_|\___\___|
 */
/**
 * Gets a wallet object if the wallet is on and properly configured
 * @return {Promise<DigiByteRPC>}
 *
 * Expected Errors: "Wallet not set up","Wallet offline or config has changed"
 */
const getWallet=async()=>{
    const {wallet}=config.get("main");
    if (wallet===undefined) throw "Wallet not set up";
    let dgbWallet=new DigiByte(wallet.user,wallet.pass,wallet.host,wallet.port);
    try {
        blockCount=await dgbWallet.getBlockCount();
        screen.green("Wallet","Connected");
    } catch (e) {
        screen.red("Wallet","Offline or misconfigured");
        throw "Wallet offline or config has changed";
    }
    return dgbWallet;
}
let blockCount; //to store block count at wallet request
// noinspection JSIgnoredPromiseFromCall
getWallet();
module.exports.calls=getWallet;


/* _____ _                                          _     _
  / ____| |                                /\      | |   | |
 | |    | |__   __ _ _ __   __ _  ___     /  \   __| | __| |_ __ ___  ___ ___  ___  ___
 | |    | '_ \ / _` | '_ \ / _` |/ _ \   / /\ \ / _` |/ _` | '__/ _ \/ __/ __|/ _ \/ __|
 | |____| | | | (_| | | | | (_| |  __/  / ____ \ (_| | (_| | | |  __/\__ \__ \  __/\__ \
  \_____|_| |_|\__,_|_| |_|\__, |\___| /_/    \_\__,_|\__,_|_|  \___||___/___/\___||___/
                            __/ |
                           |___/
 */

//get change addresses and keep up to date
let changeAddresses=[];
let syncChangeAddressesSyncing=false;   //either false or array of resolve functions
let syncPasses=0;
let syncChangeAddresses=async()=>{
    if (syncPasses-->0) return;

    //get wallet object
    let wallet=await getWallet();

    //report that its running
    syncChangeAddressesSyncing=[];

    //get list of temp change addresses
    try {
        let addresses = await getAddresses(changeAddressLabel);
        changeAddresses = [];
        for (let address of addresses) {
            if (await wallet.getReceivedByAddress(address) === 0) changeAddresses.push(address);
        }
    } catch (e) {}

    //report that its done
    while (syncChangeAddressesSyncing.length>0) syncChangeAddressesSyncing.pop()();
    syncChangeAddressesSyncing=false;
    syncPasses=syncIntervalsIfNotUsed;
}
// noinspection JSIgnoredPromiseFromCall
syncChangeAddresses();
let syncChangeAddressesTimeout=setTimeout(syncChangeAddresses,syncIfIdell);

/**
 * Resets the change address timeout.
 * If sync in place it will pause until done to prevent a race
 * @return {Promise<void>}
 */
const restartTimeout=async()=>{
    //make sure not already syncing
    if (syncChangeAddressesSyncing!==false) await new Promise(resolve=>syncChangeAddressesSyncing.push(resolve));
    syncPasses=0;
    syncChangeAddressesTimeout.refresh();
}

/**
 * Gets a new change address
 * @return {Promise<string>}
 */
module.exports.getChangeAddress=async()=>{
    //restart timeout or wait for funct to finish
    await restartTimeout();

    //return synchronously if can
    if (changeAddresses.length>0) return changeAddresses.pop();

    //create a new address and return
    let wallet=await getWallet();
    return wallet.getNewAddress(changeAddressLabel,"bech32");
}

/**
 * Returns a change address that may not have been used
 * @param address
 */
module.exports.setChangeAddress=(address)=>{
    //if in process of syncing then sync will find the address
    if (syncChangeAddressesSyncing!==false) return;

    //restart timeout
    syncChangeAddressesTimeout.refresh();   //restart timeout
    changeAddresses.push(address);
}













/*            _                               _  __          __   _ _      _
     /\      | |                             | | \ \        / /  | | |    | |
    /  \   __| |_   ____ _ _ __   ___ ___  __| |  \ \  /\  / /_ _| | | ___| |_
   / /\ \ / _` \ \ / / _` | '_ \ / __/ _ \/ _` |   \ \/  \/ / _` | | |/ _ \ __|
  / ____ \ (_| |\ V / (_| | | | | (_|  __/ (_| |    \  /\  / (_| | | |  __/ |_
 /_/    \_\__,_| \_/ \__,_|_| |_|\___\___|\__,_|     \/  \/ \__,_|_|_|\___|\__|
 */

/**
 * Removes addresses with zero balance
 * @param {string[]}    addresses
 * @return {Promise<string[]>}
 */
const removeZeroBalance=async(addresses)=>{
    let wallet=await getWallet();
    let utxos=await wallet.listUnspent(0,999999999,addresses);
    addresses=[];
    for (let {address} of utxos) addresses.push(address);
    return addresses;
}



/**
 * Returns an array of addresses
 * @param {string?}  label
 * @param {boolean?} returnLabel
 * @return {Promise<string[]|{address:string,label:string}[]>}
 */
module.exports.getAddresses=getAddresses=async(label,returnLabel=false)=>{
    let wallet=await getWallet();

    //get labels to look up
    let labels=[label];
    if (label===undefined) labels=await wallet.listLabels();

    //get list of addresses
    let addresses=[];
    for (let label of labels) {
        let data=await wallet.getAddressesByLabel(label);
        for (let address in data) {
            if (data[address]["purpose"]==="receive") addresses.push(returnLabel?{address,label}:address);
        }
    }
    return addresses;
}

/**
 * Returns a list of assets in the addresses.  DGB is returned as DigiByte
 * @param {string[]}    addresses
 * @return {Promise<{assetId:string,value:string,decimals:int,cid:string?,rules:boolean}[]>}
 */
module.exports.getAssets=async(addresses)=>{
    if (addresses.length===0) return [];

    //reduce number of addresses
    addresses=await removeZeroBalance(addresses);
    if (addresses.length===0) return [];

    //gather totals
    let dgb=0n;
    let totalAssets={};
    for (let address of addresses) {
        try {
            let utxos=await stream.json(address + "_utxos");
            for (let {value, assets} of utxos) {
                dgb+=BigInt(value);
                if (assets!==undefined) {
                    for (let {assetId,amount,decimals,cid,rules=false} of assets) {
                        //get extra data
                        let assetcache=config.get("assetcache");
                        if (assetcache[assetId]===undefined) {
                            let {rules,kyc,issuer,divisibility,metadata}=await stream.json(assetId);
                            rules=rules.pop();
                            assetcache[assetId]={rules,kyc,issuer,divisibility,metadata};
                            config.set("assetcache",assetcache);
                        }

                        //store
                        if (totalAssets[assetId+cid]===undefined) totalAssets[assetId+cid]={assetId,value:0n,decimals,cid,rules,cache: assetcache[assetId]};
                        totalAssets[assetId+cid].value+=BigInt(amount);
                    }
                }
            }
        } catch (e) {
            //no utxos
        }
    }

    //order as array
    let data=[{assetId:"DigiByte",value:dgb.toString(),decimals:8,rules:false,cache:{}}];
    for (let index in totalAssets) {
        let {assetId,value,decimals,cid,rules,cache}=totalAssets[index];
        data.push({assetId,value: value.toString(),decimals,cid,rules,cache});
    }
    return data;
}





/**
 * Finds any addresses with funds and without labels and assigns it blank label
 * @return {Promise<int>}
 */
module.exports.findMissing=async()=>{
    let count=0;
    let wallet=await getWallet();
    let utxos=await wallet.listUnspent();
    for (let {address,label} of utxos) {
        if (label===undefined) {
            count++;
            await wallet.setLabel(address,"");
        }
    }
    return count;
}

/**
 * Helper function to finalize getAssetUTXOs
 * @param {UTXO[]}  utxos
 * @param {string}  cacheIndexMajor
 * @param {BigInt}  assetCount
 * @return {*}
 */
const getAssetUTXOsFinish=(utxos,cacheIndexMajor,assetCount)=>{
    convertUtxoStrings(utxos);
    if (utxoCache[cacheIndexMajor]===undefined) utxoCache[cacheIndexMajor]={};
    utxoCache[cacheIndexMajor][assetCount.toString()]=utxos;
    return utxos;
}

/**
 * Returns required asset utxo and fills up to limit with coin utxos
 * @param {string}  assetIdNeeded
 * @param {BigInt}  quantityNeeded
 * @param {string?} label   - what label to look for funds in if blank does all
 * @param {int?}    limit   - max number of utxos to accept
 * @return {Promise<AddressUtxoData>}
 */
module.exports.getAssetUTXOs=async(assetIdNeeded,quantityNeeded,label,limit=maxUTXOs)=>{
    let cacheIndexMajor=`${assetIdNeeded}|${label||""}|${limit}`;
    screen.log(cacheIndexMajor);
    if (utxoCache[cacheIndexMajor]!==undefined) {
        //find minor index that will work if any
        let keys=Object.keys(utxoCache[cacheIndexMajor]);
        keys.sort((a,b)=>parseInt(a)-parseInt(b));          //sort small to big
        while ((keys.length>0)&&(parseInt(keys[0])<quantityNeeded)) keys.shift(); //remove keys that wont work
        if (keys.length>0) return utxoCache[cacheIndexMajor][keys[0]];            //return cache if there is one
    }

    let wallet=await getWallet();

    //get utxos we can use
    let labels=(label===undefined)?await wallet.listLabels():[label];
    let assetUTXOs=[];
    let assetCount=0n;
    let coinUTXOs=[];
    for (let label of labels) {
        //get addresses
        let addresses=await removeZeroBalance(await getAddresses(label));
        if (addresses.length===0) continue;

        //sort out usable utxos
        for (let address of addresses) {
            try {
                /** @type {AddressUtxoData} */let utxos=await stream.json(address + "_utxos");
                nextUTXO: for (let utxo of utxos) {
                    if (utxo.assets===undefined) {

                        //coin utxo
                        coinUTXOs.push(utxo);

                    } else if (assetCount<quantityNeeded) {

                        //asset utxo
                        let count=0n;
                        for (let {assetId,amount} of utxo.assets) {
                            if (assetId!==assetIdNeeded) continue nextUTXO;
                            count+=BigInt(amount);
                        }
                        assetCount+=count;
                        assetUTXOs.push(utxo);

                    }
                }
            } catch (e) {
                //no utxos
            }
        }
    }

    //see if there is enough space to use all the UTXOs
    if (assetUTXOs.length+coinUTXOs.length<limit) return getAssetUTXOsFinish([...assetUTXOs,...coinUTXOs],cacheIndexMajor,assetCount);

    //not enough space so return the largest coin UTXOs
    coinUTXOs.sort((a,b)=>parseInt(a.value)-parseInt(b.value)); //sort small to large
    while(assetUTXOs.length<limit) assetUTXOs.push(coinUTXOs.pop());     //take from end of coin(biggest) and add to asset utxos
    return getAssetUTXOsFinish(assetUTXOs,cacheIndexMajor,assetCount);
}
let utxoCache={};


/**
 * Gets a signature
 * @param {string}  address
 * @param {string}  message
 * @param {string?} password
 * @return {Promise<string>}
 */
module.exports.getSignature=async(address,message,password)=> {
    let wallet=await getWallet();
    if (password !== undefined) await wallet.walletPassPhrase(password, 60);
    let pkey = await wallet.dumpPrivKey(address);
    return wallet.signMessageWithPrivKey(pkey, message);
}

/**
 * Signs and sends a transaction and returns the txid
 * @param {string}  hex
 * @param {string?} password
 * @return {Promise<string>}
 */
module.exports.send=async(hex,password)=>{
    let wallet=await getWallet();
    if (password!==undefined) await wallet.walletPassPhrase(password,60);
    let signedHex=await wallet.signRawTransactionWithWallet(hex);
    utxoCache={};   //clear cache
    return wallet.sendRawTransaction(signedHex);
}




/*_____  _       _         _____  _____   _____    _____      _ _
 |  __ \| |     (_)       |  __ \|  __ \ / ____|  / ____|    | | |
 | |__) | | __ _ _ _ __   | |__) | |__) | |      | |     __ _| | |___
 |  ___/| |/ _` | | '_ \  |  _  /|  ___/| |      | |    / _` | | / __|
 | |    | | (_| | | | | | | | \ \| |    | |____  | |___| (_| | | \__ \
 |_|    |_|\__,_|_|_| |_| |_|  \_\_|     \_____|  \_____\__,_|_|_|___
 */

/**
 * Gets the block count
 * @return {Promise<int>}
 *
 * Expected Errors: "Wallet not set up","Wallet offline or config has changed"
 */
module.exports.getBlockCount=async()=>{
    await getWallet();              //get the wallet object
    return blockCount;              //gets set during above call
}

/**
 * Lists all labels in a wallet
 * @return {Promise<string[]>}
 */
module.exports.listLabels=async()=>(await getWallet()).listLabels();

/**
 * Creates a new address
 * @param {string}  label
 * @param {"legacy"|"bech32"}   type
 * @return {Promise<unknown>}
 */
module.exports.getNewAddress=async(label,type="bech32")=>(await getWallet()).getNewAddress(label,type);

/**
 * Creates a raw transactions and returns the hex
 * @param {{txid:string,vout:int}[]}  inputs
 * @param {Object<string>[]}          outputs
 * @return {Promise<string>}
 */
module.exports.createRawTransaction=async(inputs,outputs)=>(await getWallet()).createRawTransaction(inputs,outputs);

/**
 * Returns a list of UTXOs but converts to sat standard
 * @param {int}         minConfirms
 * @param {int}         maxConfirms
 * @param {string[]}    addressees
 * @return {Promise<UTXO[]>}
 */
module.exports.listUnspent=async(minConfirms,maxConfirms,addressees)=>{
    let wallet=await getWallet();
    let utxos=await wallet.listUnspent(minConfirms,maxConfirms,addressees);
    for (let utxo of utxos) {
        utxo.value=BigInt(utxo.amount*100000000).toString();
    }
    return utxos;
}