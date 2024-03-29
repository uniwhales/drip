const { web3tx, toWad, wad4human } = require("@decentral.ee/web3-helpers");

const deployFramework = require("@superfluid-finance/ethereum-contracts/scripts/deploy-framework");
const deployTestToken = require("@superfluid-finance/ethereum-contracts/scripts/deploy-test-token");
const deploySuperToken = require("@superfluid-finance/ethereum-contracts/scripts/deploy-super-token");
const SuperfluidSDK = require("@superfluid-finance/js-sdk");

const { MerkleTree } = require("merkletreejs");
const keccak256 = require("keccak256");

const erc20Token = artifacts.require("ERC20");
const TradeableFlow = artifacts.require("TradeableFlow.sol");

const traveler = require("ganache-time-traveler");
const { assert } = require("hardhat");
const {expect} = require("chai");
const ONE_DAY = 3600 * 24;
const ONE_HOUR = 3600;
const ONE_MINUTE = 60;
const TO_GWEI = 10**18;
let merkleTree;

describe("TradeableFlow", function () {

    let accounts;

    before(async function () {
        accounts = await web3.eth.getAccounts();
    });
    
    const errorHandler = (err) => {
        if (err) throw err;
    };

    const names = ["Drip","Admin", "Alice", "Bob", "Carol", "Dan", "Emma", "Frank"];
    const tokens = ["fDAI","fUSDC","fTUSD"]
    let affCodes = ["BlueWhale","KillerWhale","Penguin","Narwhal","Oyster","WhaleShark","GreatWhite","Beluga","PilotWhale","Bottlenose"]
    let affCodesInUse = []
    let tokensInUse = []
    let tokensNotInUse = tokens

    let sf;
    let dai;
    let daix;
    let app;
    const token_directory = {}  // token => regulartoken, supertoken
    const user_directory = {};  // alias => sf.user
    const alias_directory = {}; // address => alias

    alias_directory[`0x0000000000000000000000000000000000000000`] = "-----"

    before(async function () {
        //process.env.RESET_SUPERFLUID_FRAMEWORK = 1;
        // Deploy SuperFluid test framework
        await deployFramework(errorHandler, {
            web3,
            from: accounts[0],
        });
    });

    beforeEach(async function () {
        for (var i = 0; i < tokens.length; i++) {
            // Deploy ERC20 token
            await deployTestToken(errorHandler, [":", tokens[i]], {
                web3,
                from: accounts[0],
            });
            // Deploy SuperToken
            await deploySuperToken(errorHandler, [":", tokens[i]], {
                web3,
                from: accounts[0],
            });
        }

        // Deploy and Initialize Superfluid JS SDK framework with token
        sf = new SuperfluidSDK.Framework({
            web3,
            version: "test",
            tokens: tokens,
        });
        await sf.initialize();

        for (var i = 0; i < tokens.length; i++) {
            
            token_directory[tokens[i]] = {}
            token_directory[tokens[i]]['supertoken'] = sf.tokens[tokens[i]+"x"]
            token_directory[tokens[i]]['regulartoken'] = await sf.contracts.TestToken.at(await sf.tokens[tokens[i]].address)

        }

        // Constructing a user dictionary with the below mapping of aliases to Superfluid user objects
        // Constructing a alias diction with the mapping of addresses to aliases
        for (var i = 0; i < names.length; i++) {
            user_directory[names[i].toLowerCase()] = accounts[i];
            // user_directory[names[i].toLowerCase()].alias = names[i];
            alias_directory[user_directory[names[i].toLowerCase()]] = names[i];
            console.log(names[i],"|",accounts[i])

        }

        const leafNodes = await accounts.map(addr => keccak256(addr));
        merkleTree = new MerkleTree(leafNodes, keccak256, { sortPairs: true });
        const rootHash = merkleTree.getRoot();

        for (var i = 0; i < tokens.length; i++) {
            // Mint 100000000 regulartokens for each user 
            // Approving reception of supertokens for each user
            for (const [, user] of Object.entries(user_directory)) {
                if (alias_directory[user] === "App") return;
                await web3tx(token_directory[tokens[i]]['regulartoken'].mint, `${alias_directory[user]} mints many ${tokens[i]}`)(
                    user,
                    toWad(100000000),
                    {     
                        from: user,
                    }
                );
                await web3tx(token_directory[tokens[i]]['regulartoken'].approve, `${alias_directory[user]} approves ${tokens[i]}x`)(
                    token_directory[tokens[i]]['supertoken'].address,
                    toWad(100000000),
                    {
                        from: user,
                    }
                );

                checkTokenBalance(user,token_directory[tokens[i]]['regulartoken'])
            }

            console.log(tokens[i]+"x","|",token_directory[tokens[i]]['supertoken'].address);
        }

        //u.zero = { address: ZERO_ADDRESS, alias: "0x0" };
        console.log("Admin:", user_directory.admin);
        console.log("Host:", sf.host.address);
        console.log("CFA:", sf.agreements.cfa.address);

        // Mint "UWL" token
        uwl = await erc20Token.new(
            "Uniwhales",
            "UWL",
            {from:user_directory.alice}
        )
        // await uwl._mint(user_directory.alice.address, 5*10e18)
        console.log("$UWL Address:",uwl.address)
        console.log(`$UWL balance for Alice is ${await uwl.balanceOf(user_directory.alice)}`)

        // Deploy TradeableFlow contract
        app = await TradeableFlow.new(
            user_directory.admin,
            user_directory.drip,
            "TradeableFlow",
            "TF",
            "base-link",                                          // Base URI
            sf.host.address,
            sf.agreements.cfa.address,
            200000000000,                                         // Affiliate Portion (20%)
            "",
            rootHash
        );
        // console.log({user_directory});
        await app.setWhiteListStatus(true, 1, {from:user_directory.admin})
        console.log("TradeableFlow Owner is:", alias_directory[ await app.owner() ] )
        
        // await app.setERC20MintRestriction(0,uwl.address, {from:user_directory.admin})   // ERC20Restrict token
        // await app.setNewAcceptedToken(token_directory['fDAI']['supertoken'].address ,{from:user_directory.admin})
        // await app.setNewAcceptedToken(token_directory['fUSDC']['supertoken'].address ,{from:user_directory.admin})
        // await app.setNewAcceptedToken(token_directory['fTUSD']['supertoken'].address ,{from:user_directory.admin})

        // Create user directory record for TradeableFlow contract
        user_directory.app = app.address

        // let transferFilter = {
        //     address : app.address,
        //     topics : [
        //         id("Transfer(address,address,uint256)")
        //     ]
        // }

    });

    async function checkTokenBalance(user,token) {
        console.log(`$${await token.symbol()} Balance of`, alias_directory[user], "is:", (await token.balanceOf(user)).toString());
    }

    async function checkBalances(accounts,token) {
        for (let i = 0; i < accounts.length; ++i) {
            await checkTokenBalance(accounts[i],token);
        }
    }

    async function upgrade(accounts,supertoken) {
        for (let i = 0; i < accounts.length; ++i) {
            await web3tx(
                supertoken.upgrade,
                `${alias_directory[accounts[i]]} upgrades many ${await supertoken.symbol()}`
            )(toWad(100000000), { from: accounts[i] });
            await checkTokenBalance(accounts[i],supertoken);
        }
    }

    async function logUsers(userList) {
        let header = `USER\t`
        for (let i = 0; i < tokens.length; ++i) {
            header += `|\t${tokens[i]}x\t`
        }
        header += `|\tAFFL.\t|`
        header += `\tTOKEN ID`
        console.log(header)
        console.log("----------------------------------------------------------------------------------------------")
        for (let i = 0; i < userList.length; i++) {
            row = `${alias_directory[userList[i]]}\t`
            for (let j = 0; j < tokens.length; ++j) {
                var tempUser = sf.user({ address: userList[i], token: token_directory[tokens[j]]['supertoken'].address });
                row += `|\t${(await tempUser.details()).cfa.netFlow}\t`
            }
            row += `|\t${alias_directory[( await app.getAffiliateForSubscriber( userList[i] ) )]}\t`
            row += `|\t${( await app.getAffiliateTokenIdForSubscriber( userList[i] ) ).toString()}`
            console.log(row)
        }
        console.log("----------------------------------------------------------------------------------------------")
        bottomline = `App\t`
        for (let i = 0; i < tokens.length; ++i) {
            let tempUser = sf.user({ address: user_directory.app, token: token_directory[tokens[i]]['supertoken'].address });
            bottomline += `|\t${(await tempUser.details()).cfa.netFlow}\t`
        }
        bottomline += "|"
        console.log(bottomline)
        console.log("==============================================================================================")
    }

    async function hasFlows(user) {
        const { inFlows, outFlows } = (await user.details()).cfa.flows;
        return inFlows.length + outFlows.length > 0;
    }

    async function appStatus() {
        const isApp = await sf.host.isApp(user_directory.app.address);
        const isJailed = await sf.host.isAppJailed(user_directory.app.address);
        !isApp && console.error("App is not an App");
        isJailed && console.error("app is Jailed");
        // await checkTokenBalance(u.app,daix);
        // await checkOwner();
    }

    async function checkOwner() {
        const owner = await app.getOwner();
        console.log("Contract Owner: ", alias_directory[owner], " = ", owner);
        return owner.toString();
    }

    async function transferNFT(to) {
        const receiver = to.address || to;
        const owner = await checkOwner();
        console.log("got owner from checkOwner(): ", owner);
        console.log("receiver: ", receiver);
        if (receiver === owner) {
            console.log("user === owner");
            return false;
        }
        await app.transferFrom(owner, receiver, 1, { from: owner });
        console.log(
            "token transferred, new owner: ",
            receiver,
            " = ",
            alias_directory[receiver]
        );
        return true;
    }

    async function randomAction(userList,userStatuses,state) {
        // TODO: add in stupid scenarios like beneficiaries cancelling their streams

        let moddedUserStatuses = userStatuses

        // Admin is at first index, gets cut out here
        validUsers = userList.slice(1)
        const randomUser = validUsers[Math.floor(Math.random() * validUsers.length)];

        // randomly select an new flow rate and token if update/create flow options are selected
        let newFlow = Math.round(Math.floor(Math.random() * (1000000 - 1001 + 1) + 1001) / 1000)*1000
        let randomPaymentSuperToken = tokensInUse[Math.floor(Math.random() * tokensInUse.length)]
        // select a random payment token, but if the user provided already has a payment token in use, make it that one
        if (userStatuses[randomUser]["paymentToken"] != null) {
            randomPaymentSuperToken = userStatuses[randomUser]["paymentToken"]
        }


        const outflow = userStatuses[randomUser][randomPaymentSuperToken]
        const nfts = userStatuses[randomUser]["tokens"]

        // Option 1: NFT Transfer
        // Option 2: NFT mint
        // Option 3: Create stream (no aff code)
        // Option 4: Create stream (w/ aff code)
        // Option 5: Update stream
        // Option 6: Cancel stream
        // Option 7: Set new acceptable token
        // Option 8: Beneficiary closes stream

        let options = []
        if (outflow != 0) {
            // User already has outflows, we want to provide update and delete options
            options = [5,5,5,6]
        } else {
            // Otherwise, provide create option
            options = [3,3]
            // if there are affiliate NFTs out then make creating a stream with one an option
            if (affCodesInUse.length > 0) {
                options = options.concat([4,4,4,4,4,4,4,4])
            }
        }

        // NOTE: Limiting number of NFTs possible for minting to amount of set codes to increase actiivty in other options
        if (affCodesInUse.length <= affCodes.length) {
            options.push(2,2,2,2,2,2,2,2,2,2)
        }

        // As long as available tokens are there, permit setting a new one as an options
        if (tokensInUse.length == 0) {
            options = [7]
        } else if (tokensInUse.length < tokens.length) {
            options.push(7)
        }

        // As long as there are NFTs out there, allow for transferring of them to happen
        if (nfts.length > 0) {
            options = options.concat([1,1,1,1,1,1,1])
        }

        // As long as valid tokens have been set, allow cancellations by rogue beneficiaries to be an option
        if (tokensInUse.length > 0) {
            options = options.concat([8])
        }


        // randomly chose from available options
        let randomChoice
        if (state == -1) {
            randomChoice = options[Math.floor(Math.random() * options.length)]
        } else {
            randomChoice = state
        }

        // Some space
        console.log()

        // Option 1: NFT Transfer
        if (randomChoice == 1) {
            // Get all users that are not the user that's being operated on
            availableUsers = validUsers.filter(user => user !== randomUser)
            // Get random user to send NFT to
            const randomDestinationUser = availableUsers[Math.floor(Math.random() * availableUsers.length)]
            // If there are multiple NFTs held by randomUser, chose a random one (randomNFTForTransfer is the token id)
            const randomNFTForTransfer = nfts[Math.floor(Math.random() * nfts.length)]

            console.log(`=== ${alias_directory[randomUser]} transfers ${await app.getAffiliateCodeFromTokenId(randomNFTForTransfer)} NFT to ${alias_directory[randomDestinationUser]} ===`)

            // For randomUser get outflow rate from app pertaining to NFT
            // For randomUser get balance of NFT
            // For randomDestinationUser get balance of NFT
            
            await app.transferFrom(
                randomUser, 
                randomDestinationUser, 
                randomNFTForTransfer, 
                {from:randomUser}
            );

            // Assert that randomDestinationUser now has the outflow rate that randomUSer did for that NFT
            // Assert that randomUser now has one less than original NFT balance and randomDesinationUser has one more
            

            // Remove from randomUser's list
            moddedUserStatuses[randomUser]["tokens"] = nfts.filter(token => token !== randomNFTForTransfer)
            // Add to randomDestinationUser's list
            moddedUserStatuses[randomDestinationUser]["tokens"].push(randomNFTForTransfer)

            // console.log(await app.filters.Transfer())
            
            await logUsers(userList)

        }
        // Option 2: NFT mint
        else if (randomChoice == 2) {
            // Get random user code
            const randomNFTURI = affCodes[Math.floor(Math.random() * affCodes.length)]
            // Remove user code from global available codes list
            affCodes = affCodes.filter(code => code !== randomNFTURI)
            // Add user code to global in use codes list
            affCodesInUse.push(randomNFTURI)

            console.log(`=== ${alias_directory[randomUser]} mints affiliate NFT with URI: ${randomNFTURI}`)

            const hexProof = merkleTree.getHexProof(keccak256(randomUser));

            let tokenId = await app.mint(hexProof, randomNFTURI, {from:randomUser})

            console.log( "Token ID of Minted NFT:",parseInt(tokenId["logs"][0]["args"]["tokenId"].toString()) )

            moddedUserStatuses[randomUser]["tokens"].push(parseInt(tokenId["logs"][0]["args"]["tokenId"].toString()))

        }
        // Option 3: Create stream (no aff code)
        else if (randomChoice == 3) {

            console.log(`=== ${alias_directory[randomUser]} starts a ${randomPaymentSuperToken} stream without referral ===`)

            // get original inflow rate from randomUser to app
            // get original outflow rate from app to admin

            await sf.cfa.createFlow({
                superToken:   token_directory[randomPaymentSuperToken]["supertoken"].address, 
                sender:       randomUser,
                receiver:     user_directory.app,
                flowRate:     newFlow.toString(),
                userData:     web3.eth.abi.encodeParameter('string',"")
            });

            // assert that new flow rate from randomUser to app is + newFlow
            // assert that new flow rate from app to admin is + newFlow

            moddedUserStatuses[randomUser][randomPaymentSuperToken] = newFlow
            moddedUserStatuses[randomUser]["paymentToken"] = randomPaymentSuperToken

            await logUsers(userList)

        }
        // Option 4: Create stream (w/ aff code)
        else if (randomChoice == 4) {
            // Randomly select in in-use code
            const randAffCode = affCodesInUse[Math.floor(Math.random() * affCodesInUse.length)]

            console.log(`=== ${alias_directory[randomUser]} starts a ${randomPaymentSuperToken} stream with referral ${randAffCode}===`)

            // get original inflow rate of randomUser
            // get original outflow rate to admin
            // get original outflow rate to aff associated with randAffCode (TODO: make getTokenIdFromAffiliateCode)
            // await app.setNewAcceptedToken(token_directory[randomPaymentSuperToken]['supertoken'].address ,{from:user_directory.admin})
            await sf.cfa.createFlow({
                superToken:   token_directory[randomPaymentSuperToken]["supertoken"].address, 
                sender:       randomUser,
                receiver:     user_directory.app,
                flowRate:     newFlow.toString(),
                userData:     web3.eth.abi.encodeParameter('string',randAffCode)
            });

            // assert that new flow rate from randomUser to app is + newFlow
            // assert that new flow rate from app to aff is + newFlow*20%
            // assert that new flow rate from app to admin is newFlow - (newFlow*20%)

            moddedUserStatuses[randomUser][randomPaymentSuperToken] = newFlow
            moddedUserStatuses[randomUser]["paymentToken"] = randomPaymentSuperToken

            await logUsers(userList)
        }
        // Option 5: Update stream
        else if (randomChoice == 5) {

            console.log(`=== ${alias_directory[randomUser]} updates their ${randomPaymentSuperToken} stream ===`)

            // get original inflow rate from randomUser to app
            // get original outflow rate from app to admin

            await sf.cfa.updateFlow({
                superToken:   token_directory[randomPaymentSuperToken]["supertoken"].address, 
                sender:       randomUser,
                receiver:     user_directory.app,
                flowRate:     newFlow.toString(),
            });

            // NOTE: think a little more about users that cancel and restart their subscriptions and the retainance of their profile
            // assert that new flow rate from randomUser to app is + (newFlow - originalFlow)
            // if user is not affiliated
                // assert that new flow rate from app to admin is + (newFlow - originalFlow)
            // if user is affiliated
                // assert that new flow rate from app to aff is + (newFlow - originalFlow)*20%
                // assert that new flow rate from app to admin is (newFlow - originalFlow) - ((newFlow - originalFlow)*20%)
        
            moddedUserStatuses[randomUser][randomPaymentSuperToken] = newFlow

            await logUsers(userList)
        }
        // Option 6: Cancel stream
        else if (randomChoice == 6) {

            console.log(`=== ${alias_directory[randomUser]} cancels their ${randomPaymentSuperToken} stream ===`)

            // get original inflow rate from randomUser to app
            // get original outflow rate from app to admin

            await sf.cfa.deleteFlow({
                superToken:   token_directory[randomPaymentSuperToken]["supertoken"].address, 
                sender:       randomUser,
                receiver:     user_directory.app,
                by:           randomUser
            });

            // assert that new flow rate from randomUser to app is + (newFlow - originalFlow)
            // if user is not affiliated
                // assert that new flow rate from app to admin is + (newFlow - originalFlow)
            // if user is affiliated
                // assert that new flow rate from app to aff is + (newFlow - originalFlow)*20%
                // assert that new flow rate from app to admin is (newFlow - originalFlow) - ((newFlow - originalFlow)*20%)

            moddedUserStatuses[randomUser][randomPaymentSuperToken] = 0
            moddedUserStatuses[randomUser]["paymentToken"] = null

            await logUsers(userList)
        }
        // Option 7: Set new acceptable token
        else if (randomChoice == 7) {
            let randomPaymentSuperToken = tokensNotInUse[Math.floor(Math.random() * tokensNotInUse.length)]
            console.log(`=== Setting new accepted token: ${randomPaymentSuperToken} ===`)
            await app.setNewAcceptedToken(token_directory[randomPaymentSuperToken]['supertoken'].address ,{from:user_directory.admin})
            tokensNotInUse = tokensNotInUse.filter(token => token !== randomPaymentSuperToken)
            tokensInUse.push(randomPaymentSuperToken)
        }
        // Option 8: Beneficiary closes stream
        else if (randomChoice == 8) {
            // Set up for Option 8
            let rogueBeneficiaries = []
            // If owner has inflow, allow the owner to try cancelling their own stream

            let ownerUser = sf.user({ address: user_directory.admin, token: token_directory[randomPaymentSuperToken]['supertoken'].address });
            let ownerFlow = (await ownerUser.details()).cfa.netFlow
            if (ownerFlow > 0) {
                rogueBeneficiaries.push(user_directory.admin)
            }
            // Iterate over active affiliate codes. If affiliate possesses an income flow, then add to rogueBeneficiaries
            for (var i = 0; i < affCodesInUse.length; i++) {
                let tokenIdFromAffCode = await app.getTokenIdFromAffiliateCode( affCodesInUse[i] )
                affiliateFromTokenId = await app.getAffiliateFromTokenId(tokenIdFromAffCode)

                let flowRate = await sf.cfa.getFlow({superToken: token_directory[randomPaymentSuperToken]['supertoken'].address, sender: user_directory.app, receiver: affiliateFromTokenId})
                if (flowRate > 0) {
                    rogueBeneficiaries.push(affiliateFromTokenId)
                }
            }

            for (var i = 0; i < rogueBeneficiaries.length; i++) {
                console.log(alias_directory[rogueBeneficiaries[i]])
            }
            // randomly chose a rogueBeneficiary
            let rogueBeneficiary = rogueBeneficiaries[Math.floor(Math.random() * rogueBeneficiaries.length)]

            if (rogueBeneficiaries.length == 0) {
                randomAction(userList,userStatuses,state)
                return moddedUserStatuses
            }
            
            console.log(`=== Rogue Beneficiary ${alias_directory[rogueBeneficiary]} cancels their ${randomPaymentSuperToken} stream ===`)

            await sf.cfa.deleteFlow({
                superToken:   token_directory[randomPaymentSuperToken]["supertoken"].address, 
                sender:       user_directory.app,
                receiver:     rogueBeneficiary,
                by:           rogueBeneficiary
            });

            await logUsers(userList)

        }

        // assert that app netflow is zero

        return moddedUserStatuses

    }
   
    describe("sending flows", async function () {

        let switchBoard = {
            "NFT Testing":false,
            "transferring pre-cashflow NFT":false,
            "subscriber switching payment tokens":false,
            "_updateOutflow w/ 2 aff, 3 subs (increase then decrease)": false,
            "_createOutflow w/ aff, 1 subscribers, NFT transfer": false,
            "_updateOutflow w/ 2 aff, 3 subs (increase then decrease), NFT transfer": false,
            "affiliate being a subscriber as well":false,
            "testing affiliate and owner flow cancelling":true,
            "testing setting acceptable token":false,
            "advanced multi-NFT case":false,
            "restrict owner flow":false,
            "locking app":false,
            "balance sweep":false,
            "random test":false,
            "monetization testing":false,
            "adhoc":false,
            "refcodes getter":false,
            "whitelist testing":false
        }

        if (switchBoard["NFT Testing"]) {
            
            it("Testing Token Requirements", async () => {
                const { alice , bob } = user_directory
                uwl.transfer(bob,10000, {from:alice})
                await checkTokenBalance(bob,uwl)
                const hexProof = merkleTree.getHexProof(keccak256(bob));
                await app.mint(hexProof, "BlueWhale", {from:bob})
                console.log("NFT Balance of Bob:", (await app.balanceOf(bob)).toString() )
                console.log("URI of NFT:", (await app.tokenURI(1)))

                // TODO: test changing ERC20 restrictions
                await expect(app.mint(hexProof, "Orca", {from:bob})).to.be.revertedWith("!mintLimit");
            });
        }

        if (switchBoard["testing setting acceptable token"]) {

            it("testing setting acceptable token", async () => {

                // SET UP
                const { alice , bob , carol , admin } = user_directory
                userList = [alice , bob , carol , admin]

                // Mint Alice 10000 $UWL and an affiliate NFT (Alice already has all the $UWL)
                const hexProof = merkleTree.getHexProof(keccak256(alice));
                await app.mint(hexProof, "BlueWhale", {from:alice})

                // Upgrade all of Alice and Bob's DAI
                await upgrade([alice,bob,carol,admin],token_directory["fDAI"]["supertoken"]);

                // Give App a little DAIx so it doesn't get mad over deposit allowance
                await token_directory["fDAI"]["supertoken"].transfer(user_directory.app, 100000000000000, {from:alice});

                let affiliateUserData1 = web3.eth.abi.encodeParameter('string',"BlueWhale");

                // console.log('=== PART 1: Testing opening up a DAI stream to the app with the affiliate code without having set an acceptable token (should fail) ===')

                // await sf.cfa.createFlow({
                //     superToken:   token_directory["fDAI"]["supertoken"].address, 
                //     sender:       alice,
                //     receiver:     user_directory.app,
                //     flowRate:     "10000",
                //     userData:     affiliateUserData1});
    
                // await logUsers(userList);
                console.log({token_directory})
                console.log("=== PART 1: Setting a valid super token (fDAIx) for payment ===")
                await app.setNewAcceptedToken(token_directory['fDAI']['supertoken'].address ,{from:user_directory.admin})

                console.log("=== PART 2: Setting a valid super token (fUSDC) for payment ===")
                await app.setNewAcceptedToken(token_directory['fUSDC']['supertoken'].address ,{from:user_directory.admin})

                console.log("=== PART 3: Setting a super token (fDAIx) for payment again should return error ===")
                await expect(app.setNewAcceptedToken(token_directory['fDAI']['supertoken'].address ,{from:user_directory.admin})).to.be.revertedWith("alreadyset");

            })

        }

        if (switchBoard["restrict owner flow"]) {

            it("restrict owner flow", async () => {
            // SET UP
                const { alice , bob , carol , admin } = user_directory
                userList = [alice , bob , carol , admin]

                // Mint Alice 10000 $UWL and an affiliate NFT (Alice already has all the $UWL)
                const hexProof = merkleTree.getHexProof(keccak256(alice));
                await app.mint(hexProof, "BlueWhale", {from:alice})

                // Upgrade all of Alice and Bob's DAI
                await upgrade([alice,bob,carol,admin],token_directory["fDAI"]["supertoken"]);
                await upgrade([alice,bob,carol,admin],token_directory["fUSDC"]["supertoken"]);

                // Give App a little DAIx so it doesn't get mad over deposit allowance
                await token_directory["fDAI"]["supertoken"].transfer(user_directory.app, 100000000000000, {from:alice});
                await token_directory["fUSDC"]["supertoken"].transfer(user_directory.app, 100000000000000, {from:alice});

                let affiliateUserData1 = web3.eth.abi.encodeParameter('string',"BlueWhale");

                // comment out the setNewAcceptedToken lines in beforeEach
                console.log('=== PART 1: Owner opens up a DAI stream to the app with the affiliate code (should fail) ===')
                

                await expect(sf.cfa.createFlow({
                    superToken:   token_directory["fDAI"]["supertoken"].address, 
                    sender:       bob,
                    receiver:     user_directory.app,
                    flowRate:     "10000",
                    userData:     affiliateUserData1})).to.be.revertedWith("RedirectAll: not accepted token");
                
                // set Acceptable tokens
                await app.setNewAcceptedToken(token_directory['fDAI']['supertoken'].address ,{from:user_directory.admin})
                await app.setNewAcceptedToken(token_directory['fUSDC']['supertoken'].address ,{from:user_directory.admin})
                let bobDaiBalance = await token_directory["fDAI"]["supertoken"].balanceOf(bob)
                console.log("before balance", bobDaiBalance.toString());
                
                await sf.cfa.createFlow({
                    superToken:   token_directory["fDAI"]["supertoken"].address, 
                    sender:       bob,
                    receiver:     user_directory.app,
                    flowRate:     "10000",
                    userData:     affiliateUserData1})
                
                bobDaiBalance = await token_directory["fDAI"]["supertoken"].balanceOf(bob)
                console.log("after balance", bobDaiBalance.toString());
                await logUsers(userList);
                
                await sf.cfa.updateFlow({
                    superToken:   token_directory["fDAI"]["supertoken"].address, 
                    sender:       bob,
                    receiver:     user_directory.app,
                    flowRate:     "5000",
                    userData:     affiliateUserData1})
                await logUsers(userList);
                
                bobDaiBalance = await token_directory["fDAI"]["supertoken"].balanceOf(bob)
                console.log("after balance", bobDaiBalance.toString());

                await sf.cfa.deleteFlow({
                    superToken:   token_directory["fDAI"]["supertoken"].address, 
                    sender:       bob,
                    receiver:     user_directory.app,
                    userData:     affiliateUserData1})
                
                bobDaiBalance = await token_directory["fDAI"]["supertoken"].balanceOf(bob)
                console.log("after balance", bobDaiBalance.toString());
                
                await logUsers(userList);

                await sf.cfa.createFlow({
                    superToken:   token_directory["fDAI"]["supertoken"].address, 
                    sender:       bob,
                    receiver:     user_directory.app,
                    flowRate:     "10000",
                    userData:     affiliateUserData1})
                
                bobDaiBalance = await token_directory["fDAI"]["supertoken"].balanceOf(bob)
                console.log("after balance", bobDaiBalance.toString());
                await logUsers(userList);

                await expect(sf.cfa.createFlow({
                    superToken:   token_directory["fUSDC"]["supertoken"].address, 
                    sender:       bob,
                    receiver:     user_directory.app,
                    flowRate:     "10000",
                    userData:     affiliateUserData1})).to.be.revertedWith("!token");

            })
        }

        if (switchBoard["locking app"]) {

            it("locking app", async () => {
            // SET UP
                const { alice , bob , carol , admin } = user_directory
                userList = [alice , bob , carol , admin]

                // Mint Alice 10000 $UWL and an affiliate NFT (Alice already has all the $UWL)
                const hexProof = merkleTree.getHexProof(keccak256(alice));
                await app.mint(hexProof, "BlueWhale", {from:alice})

                // Upgrade all of Alice and Bob's DAI
                await upgrade([alice,bob,carol,admin],token_directory["fDAI"]["supertoken"]);
                await upgrade([alice,bob,carol,admin],token_directory["fUSDC"]["supertoken"]);

                // Give App a little DAIx so it doesn't get mad over deposit allowance
                await token_directory["fDAI"]["supertoken"].transfer(user_directory.app, 100000000000000, {from:alice});
                await token_directory["fUSDC"]["supertoken"].transfer(user_directory.app, 100000000000000, {from:alice});

                // set Acceptable tokens
                await app.setNewAcceptedToken(token_directory['fDAI']['supertoken'].address ,{from:user_directory.admin})
                await app.setNewAcceptedToken(token_directory['fUSDC']['supertoken'].address ,{from:user_directory.admin})

                let affiliateUserData1 = web3.eth.abi.encodeParameter('string',"BlueWhale");

                console.log('=== PART 1: Bob opens up a DAI stream to the app with the affiliate code ===')
                
                await sf.cfa.createFlow({
                    superToken:   token_directory["fDAI"]["supertoken"].address, 
                    sender:       bob,
                    receiver:     user_directory.app,
                    flowRate:     "10000",
                    userData:     affiliateUserData1});
    
                await logUsers(userList);

                console.log('=== PART 2: lock the app  ===')

                await app.lock({from:user_directory.drip})

                console.log('=== PART 3: Bob tries to update stream to app (should fail)  ===')

                await expect(sf.cfa.updateFlow({
                    superToken: token_directory["fDAI"]["supertoken"].address,
                    sender: bob,
                    receiver: user_directory.app,
                    flowRate: "10001"
                })).to.be.revertedWith("locked");

                console.log('=== PART 4: unlock the app  ===')
                await app.unlock({from:user_directory.drip} )

                console.log('=== PART 5: Bob updates stream to app  ===')

                await sf.cfa.updateFlow({
                    superToken: token_directory["fDAI"]["supertoken"].address,
                    sender: bob,
                    receiver: user_directory.app,
                    flowRate: "10001"
                });

                await logUsers(userList);

                // console.log('=== PART 3: owner cancel Alice flow  ===')

                // await app._emergencyCloseStream(alice,token_directory["fDAI"]["supertoken"].address,{from:user_directory.admin})

                // await logUsers(userList);

            })
        }

        if (switchBoard["balance sweep"]) {

            it("balance sweep", async () => {

                // SET UP
                const { alice , bob , emma , carol , dan , admin } = user_directory
                userList = [alice , bob , emma , carol , dan , admin]

            // Upgrade all of Alice, Carol, and Bob's DAI
                await upgrade([alice,bob,carol,dan,emma],token_directory["fDAI"]["supertoken"])

            // Give App a little DAIx so it doesn't get mad over deposit allowance
                await token_directory["fDAI"]["supertoken"].transfer(user_directory.app, 100000000000000, {from:alice})

                console.log("Before sweep")
                await checkTokenBalance(user_directory.app,token_directory["fDAI"]["supertoken"])

                await app.lock({from:user_directory.admin} )

                await app.balanceSweep(token_directory["fDAI"]["supertoken"].address,1,{from:admin})

                console.log("After sweep")
                await checkTokenBalance(user_directory.app,token_directory["fDAI"]["supertoken"])


            })
        }
        
        if (switchBoard["random test"]) {
            it("random test", async () => {
                // Get all users
                const { admin, alice, bob, carol, dan, emma, frank } = user_directory
                userList = [admin, alice, bob, carol, dan, emma, frank] 

                // Upgrade all their tokens ["fDAI","fUSDC","fTUSD","fFRAX"]
                await upgrade(userList,token_directory["fDAI"]["supertoken"]);
                await upgrade(userList,token_directory["fUSDC"]["supertoken"]);
                await upgrade(userList,token_directory["fTUSD"]["supertoken"]);


                // Give App a little supertoken so it doesn't get mad over deposit allowance
                // This is a vulnerability vector - how much should you deposit to ensure app doesn't go under?
                await token_directory["fDAI"]["supertoken"].transfer(user_directory.app, 100000000000000, {from:admin});
                await token_directory["fUSDC"]["supertoken"].transfer(user_directory.app, 100000000000000, {from:admin});
                await token_directory["fTUSD"]["supertoken"].transfer(user_directory.app, 100000000000000, {from:admin});


                // Make user tracking dictionary
                let userStatuses = {}
                for (var i = 0; i < userList.length; i++) {
                    userStatuses[userList[i]] = {"tokens":[],"fDAI":0,"fUSDC":0,"fTUSD":0,"paymentToken":null}
                }

                // for (var i = 0; i < 400; i++) {
                    userStatuses = await randomAction(userList,userStatuses,-1);
                // }
            })
        }

        if (switchBoard["monetization testing"]) {
            it("monetization testing", async () => {
                // Get all users
                const { admin, alice, bob, carol, dan, emma, frank } = user_directory
                userList = [admin, alice, bob, carol, dan, emma, frank] 

                // console.log("=== We set a subscription requirement of 100000000000000000 per second ===")

                // await app.setDripSubscriptionRequirement("100000000000000000",{from:user_directory.drip})

                console.log(`=== Setting new accepted token: fTUSDx ===`)
                await app.setNewAcceptedToken(token_directory['fTUSD']['supertoken'].address ,{from:user_directory.admin})

                // Upgrade all their tokens ["fTUSD"]
                await upgrade(userList,token_directory["fTUSD"]["supertoken"]);

                // Give App a little supertoken so it doesn't get mad over deposit allowance
                await token_directory["fTUSD"]["supertoken"].transfer(user_directory.app, 100000000000000, {from:alice});

                console.log("=== Carol starts a fTUSD stream without referral ===")

                await sf.cfa.createFlow({
                    superToken:   token_directory["fTUSD"]["supertoken"].address, 
                    sender:       carol,
                    receiver:     user_directory.app,
                    flowRate:     "39000",
                    userData:     web3.eth.abi.encodeParameter('string',"")
                });

                console.log("=== Drip isn't getting paid, we decide to lock program ===")

                await app.lock({from:user_directory.drip})

                console.log("=== Carol tries to update her fTUSD stream ===")

                await sf.cfa.updateFlow({
                    superToken:   token_directory["fTUSD"]["supertoken"].address, 
                    sender:       carol,
                    receiver:     user_directory.app,
                    flowRate:     "40000",
                })

                // await logUsers(userList); 

                // console.log("=== Bob mints affiliate NFT with URI: Oyster")
                
                // await app.mint("Oyster", {from:bob})

                // console.log("=== Alice starts a fTUSD stream with referral Oyster===")

                // await sf.cfa.createFlow({
                //     superToken:   token_directory["fTUSD"]["supertoken"].address, 
                //     sender:       alice,
                //     receiver:     user_directory.app,
                //     flowRate:     "28000",
                //     userData:     web3.eth.abi.encodeParameter('string',"Oyster")
                // });

                // await logUsers(userList); 

                // console.log("=== Carol cancels their fTUSD stream ===")

                // await sf.cfa.deleteFlow({
                //     superToken: token_directory["fTUSD"]["supertoken"].address,
                //     sender:     carol,
                //     receiver:   user_directory.app,
                //     by:         carol
                // });

                // await logUsers(userList); 

                // console.log("=== Frank mints affiliate NFT with URI: Bottlenose")

                // await app.mint("Bottlenose", {from:frank})

                // console.log("=== Dan starts a fTUSD stream with referral Bottlenose===")

                // await sf.cfa.createFlow({
                //     superToken:   token_directory["fTUSD"]["supertoken"].address, 
                //     sender:       dan,
                //     receiver:     user_directory.app,
                //     flowRate:     "800000",
                //     userData:     web3.eth.abi.encodeParameter('string',"Bottlenose")
                // });

                // await logUsers(userList); 

                // console.log("=== Bob mints affiliate NFT with URI: KillerWhale")

                // await app.mint("KillerWhale", {from:bob})

                // console.log("=== Alice updates their fTUSD stream ===")

                // await sf.cfa.updateFlow({
                //     superToken: token_directory["fTUSD"]["supertoken"].address,
                //     sender: alice,
                //     receiver: user_directory.app,
                //     flowRate: "458000"
                // });

                // await logUsers(userList); 

            })
        }

        if (switchBoard["testing affiliate and owner flow cancelling"]) {

            it("testing affiliate and owner flow cancelling", async () => {
            // SET UP
                const { alice , bob , carol , admin } = user_directory
                userList = [alice , bob , carol , admin]
        
                // Mint Alice 10000 $UWL and an affiliate NFT (Alice already has all the $UWL)
                let hexProof = merkleTree.getHexProof(keccak256(alice));
                await app.mint(hexProof, "BlueWhale", {from:alice})
        
                // Upgrade all of Alice and Bob's DAI
                await upgrade([alice,bob,carol],token_directory["fDAI"]["supertoken"]);
                await upgrade([alice,bob,carol],token_directory["fUSDC"]["supertoken"]);
        
                // Give App a little DAIx so it doesn't get mad over deposit allowance
                await token_directory["fDAI"]["supertoken"].transfer(user_directory.app, 100000000000000, {from:alice});
                await token_directory["fUSDC"]["supertoken"].transfer(user_directory.app, 100000000000000, {from:alice});
                
                // set Acceptable tokens
                await app.setNewAcceptedToken(token_directory['fDAI']['supertoken'].address ,{from:user_directory.admin})
                await app.setNewAcceptedToken(token_directory['fUSDC']['supertoken'].address ,{from:user_directory.admin})
                
                let affiliateUserData1 = web3.eth.abi.encodeParameter('string',"BlueWhale");
        
                console.log('=== PART 1: Bob opens up a DAI stream to the app with the affiliate code ===')
        
                await sf.cfa.createFlow({
                    superToken:   token_directory["fDAI"]["supertoken"].address, 
                    sender:       bob,
                    receiver:     user_directory.app,
                    flowRate:     "10000",
                    userData:     affiliateUserData1
                });
        
                await logUsers(userList)
        
                console.log('=== PART 2: Alice cancels her income stream (for some reason she just wanted to fuck with us) ===')
        
                await sf.cfa.deleteFlow({
                    superToken: token_directory["fDAI"]["supertoken"].address,
                    sender:     user_directory.app,
                    receiver:   alice,
                    by:         alice
                });
        
        
                // App loses net zero here
                await logUsers(userList)
        
                console.log('=== PART 3: Alice transfers away her affiliate NFT to Bob ===')
        
                await app.transferFrom(
                    alice, 
                    bob, 
                    1, 
                    {from:alice}
                );
        
                await logUsers(userList)
        
                console.log('=== PART 4: Now the owner decides to fuck with us and cancels subscription stream! ===')
        
                await sf.cfa.deleteFlow({
                    superToken: token_directory["fDAI"]["supertoken"].address,
                    sender:     user_directory.app,
                    receiver:   user_directory.admin,
                    by:         user_directory.admin
                });
        
                await logUsers(userList)
        
                console.log('=== PART 5: Alice starts a stream with Bob affiliate code ===')
        
                await sf.cfa.createFlow({
                    superToken:   token_directory["fDAI"]["supertoken"].address, 
                    sender:       alice,
                    receiver:     user_directory.app,
                    flowRate:     "10000",
                    userData:     affiliateUserData1
                });
        
                await logUsers(userList)
            })
        }

        if (switchBoard["adhoc"]) {

            it("adhoc", async () => {
            // SET UP
                const { admin, alice, bob, carol, dan, emma, frank } = user_directory
                userList = [admin, alice, bob, carol, dan, emma, frank] 
        
                // Mint Alice 10000 $UWL and an affiliate NFT (Alice already has all the $UWL)
                await app.mint("Beluga", {from:emma})
                await app.mint("Dolphin", {from:emma})
                await app.mint("Oyster", {from:dan})
        
                // Upgrade all of Alice and Bob's DAI
                await upgrade(userList,token_directory["fUSDC"]["supertoken"]);
                await upgrade(userList,token_directory["fDAI"]["supertoken"]);

        
                // Give App a little fUSDCx so it doesn't get mad over deposit allowance
                await token_directory["fUSDC"]["supertoken"].transfer(user_directory.app, 100000000000000, {from:alice});
                await token_directory["fDAI"]["supertoken"].transfer(user_directory.app, 100000000000000, {from:alice});


                let affiliateUserData1 = web3.eth.abi.encodeParameter('string',"Beluga");
                let affiliateUserData2 = web3.eth.abi.encodeParameter('string',"Dolphin");
                let affiliateUserData3 = web3.eth.abi.encodeParameter('string',"Oyster");

                // console.log('=== PART 0: Emma opens up a DAI stream to the app with no affiliate code ===')

                // await sf.cfa.createFlow({
                //     superToken:   token_directory["fDAI"]["supertoken"].address, 
                //     sender:       emma,
                //     receiver:     user_directory.app,
                //     flowRate:     "210000",
                //     userData:     web3.eth.abi.encodeParameter('string',"")
                // });

                // await logUsers(userList); 

                // console.log('=== PART 0: Emma updates DAI stream to SAME amount ===')

                // await sf.cfa.updateFlow({
                //     superToken: token_directory["fDAI"]["supertoken"].address,
                //     sender: emma,
                //     receiver: user_directory.app,
                //     flowRate: "210000"
                // });

                // await logUsers(userList); 

                console.log('=== PART 1: Alice opens up a stream to the app with Dans affiliate code ===')

                await sf.cfa.createFlow({
                    superToken:   token_directory["fUSDC"]["supertoken"].address, 
                    sender:       alice,
                    receiver:     user_directory.app,
                    flowRate:     "706000",
                    userData:     affiliateUserData3
                });

                await logUsers(userList); 
                console.log(await app.getSubscribersFromTokenId(3)) // Dan is Oyster, token id 3

                console.log('=== PART 2: Carol opens up a stream to the app with the Emmas second affiliate code ===')
            
                await sf.cfa.createFlow({
                    superToken:   token_directory["fUSDC"]["supertoken"].address, 
                    sender:       carol,
                    receiver:     user_directory.app,
                    flowRate:     "7000",
                    userData:     affiliateUserData3
                });

                await logUsers(userList);
                console.log(await app.getSubscribersFromTokenId(3))

                console.log('=== PART 3: Carol cancels flow ===')
            
                await sf.cfa.deleteFlow({
                    superToken: token_directory["fUSDC"]["supertoken"].address,
                    sender:     carol,
                    receiver:   user_directory.app,
                    by:         carol
                });

                await logUsers(userList); 
                console.log(await app.getSubscribersFromTokenId(3))

                console.log('=== PART 4: Carol opens up a stream to the app with the Emmas second affiliate code ===')
            
                await sf.cfa.createFlow({
                    superToken:   token_directory["fUSDC"]["supertoken"].address, 
                    sender:       carol,
                    receiver:     user_directory.app,
                    flowRate:     "7000",
                    userData:     affiliateUserData3
                });

                await logUsers(userList); 
                console.log(await app.getSubscribersFromTokenId(3))

            })
        }

        if (switchBoard["refcodes getter"]) {

            it("refcodes getter", async () => {
                
                const { admin, alice, bob, carol, dan, emma, frank } = user_directory
                userList = [admin, alice, bob, carol, dan, emma, frank] 
        
                // Mint Alice 10000 $UWL and an affiliate NFT (Alice already has all the $UWL)
                await app.mint("Beluga", {from:emma})
                await app.mint("Dolphin", {from:emma})
                await app.mint("Oyster", {from:dan})

                let w = await app.getAffiliateCodesFromTokenIds([1,3])

                console.log(w)

                let x = await app.getAffiliateCodesFromTokenIds([1,3])

                console.log(x)

                let y = await app.getAffiliateCodesFromTokenIds([2,1,3])

                console.log(y)

                let z = await app.getAffiliateCodesFromTokenIds([2])

                console.log(z)


            })
        
        }

        // if (switchBoard["whitelist testing"]) {

        //     it("whitelist testing", async () => {

        //         const { admin, alice, bob, carol, dan, emma, frank } = user_directory
        //         userList = [admin, alice, bob, carol, dan, emma, frank]

        //         // Turn on whitelist with limit of 1 NFT per address
        //         await app.setWhiteListStatus(true, 1, {from:admin})

        //         // Set whitelisted addresses
        //         await app.setWhiteList(alice,true,{from:admin})
        //         await app.setWhiteList(bob,true,{from:admin})
        //         await app.setWhiteList(carol,true,{from:admin})

        //         // Let Alice, Bob, and Carol try minting
        //         await app.mint("Beluga", {from:alice})
        //         await app.mint("Dolphin", {from:bob})
        //         await app.mint("Oyster", {from:carol})
        //         console.log("Alice, Bob, Carol finish minting")

        //         // Let them try minting again, expecting reversion because limit is one
        //         await expect( app.mint("Belug", {from:alice}) ).to.be.revertedWith("!mintLimit");
        //         await expect( app.mint("Dolphi", {from:alice}) ).to.be.revertedWith("!mintLimit");
        //         console.log("Alice 2nd mint reverts")
        //         await expect( app.mint("Dolphi", {from:bob}) ).to.be.revertedWith("!mintLimit");
        //         console.log("Bob 2nd mint reverts")
        //         await expect( app.mint("Oyste", {from:carol}) ).to.be.revertedWith("!mintLimit");
        //         console.log("Carol 2nd mint reverts")
                
        //         // Let Dan try minting, expecting reversion
        //         await expect( app.mint("Lobster", {from:dan}) ).to.be.revertedWith("!whitelisted");
        //         console.log("Dan non-whitelisted mint attempt reverted")

        //         // Whitelist Dan and then let him try minting
        //         await app.setWhiteList(dan,true,{from:admin})
        //         app.mint("Whale", {from:dan})
        //         console.log("Dan now whitelisted, can mint")

        //         // Whitelisted Dan tries minting another NFT, reverts
        //         await expect( app.mint("Dolphi", {from:dan}) ).to.be.revertedWith("!mintLimit");
        //         console.log("Dan 2nd mint reverts")


        //         // Un-whitelist Dan and Bob and let Dan try minting, expecting reversion
        //         app.setWhiteList(dan,false,{from:admin})
        //         app.setWhiteList(bob,false,{from:admin})
        //         await expect( app.mint("BigWhale", {from:dan}) ).to.be.revertedWith("!whitelisted");
        //         await expect( app.mint("BigWhale", {from:bob}) ).to.be.revertedWith("!whitelisted");

        //         // Turn off whitelist
        //         await app.setWhiteListStatus(false, await app.mintLimit(), {from:admin})

        //         // Frank tries minting multiple NFTs
        //         await app.mint("Clam", {from:frank})
        //         await app.mint("Clam1", {from:frank})
        //         await app.mint("Clam2", {from:frank})

        //         console.log( "Alice Balance:",(await app.balanceOf(alice)).toString() )
        //         console.log("Bob Balance:",(await app.balanceOf(bob)).toString() )
        //         console.log("Carol Balance:",(await app.balanceOf(carol)).toString() )
        //         console.log("Dan Balance:",(await app.balanceOf(dan)).toString() )
        //         console.log("Frank Balance:",(await app.balanceOf(frank)).toString() )


        //     })

        // }

    });
});