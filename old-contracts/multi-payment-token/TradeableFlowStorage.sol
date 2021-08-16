pragma solidity ^0.8.0;

import {
    ISuperfluid,
    ISuperToken
} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";

import {
    IConstantFlowAgreementV1
} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/agreements/IConstantFlowAgreementV1.sol";



library TradeableFlowStorage  {

   // Subscriber's details
  struct SubscriberProfile {                           
    ISuperToken superToken;                              // the super token that the subscriber is paying with
    int96 inflowRate;                                    // how much subscriber is streaming into the app [DEPRICATED]
    uint256 tokenId;                                     // the tokenId representing the affiliate from which the subscriber was referred
  }

  struct AffiliateProgram {                                                             // An affiliate progarm generate when TradeableCashflow is deployed
    address owner;                                                                      // Program owner
    ISuperfluid host;                                                                   // Superfluid host contract
    IConstantFlowAgreementV1 cfa;                                                       // The stored constant flow agreement class address
    // ISuperToken acceptedToken;                                                       // The accepted token (e.g. DAIx) [DEPRICATED]
    mapping(ISuperToken => bool) acceptedTokens;                                        // Mapping of all ERC20s accepted for affiliate program payment
    mapping(ISuperToken => mapping(address => int96)) superTokentoAffiliateToOutflow;   // For each superToken, provide a mapping of each affiliate to their outflow rate (how much they're earning)
    // mapping(address => int96) affiliateToOutflow;                                    // Maps affiliate address to their outflow rate [DEPRICATED]
    mapping(uint256 => address) tokenToAffiliate;                                       // Maps token ID to affiliate address
    mapping(string => uint256) referralcodeToToken;                                     // Maps referral code to tokenIds
    mapping(address => SubscriberProfile) subscribers;                                  // Maps subscriber to [how much subscriber is streaming into the app] + [the affiliate who referred the subscriber]
    int96 affiliatePortion;                                                             // Portion of referred subscriber revenue that corresponding affiliates receive ( affiliatePortion / 10000 ) should equal desired portion. If this is greater than 10000, contract will NOT work
  }

}