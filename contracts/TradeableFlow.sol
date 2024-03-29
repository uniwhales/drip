//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
pragma abicoder v2;

import "hardhat/console.sol";

import {RedirectAll, ISuperToken, IConstantFlowAgreementV1, ISuperfluid} from "./RedirectAll.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/Counters.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "./TradeableFlowStorage.sol";
import "./AddrArrayLib.sol";

/// @author Drip Finance
/// @title Affiliate Cashflow NFT
contract TradeableFlow is ERC721, ERC721Enumerable, ERC721URIStorage, RedirectAll {

  // Packages
  using Strings for uint256;                                                    // clever package which lets you cast uints to strings
  using Counters for Counters.Counter;
  using AddrArrayLib for AddrArrayLib.Addresses;
  Counters.Counter tokenIds;

  // Roles
  address public owner;                                                         // Public owner address for visibility
  address public drip;                                                          // Sets address of Uniwhale's presiding Drip wallet
 
  // ERC20 Limitation Option
  address public ERC20MintRestrict;                                             // ERC20 token for which you must have enough balance to mint TradeableFlow NFT
  uint256 public ERC20MintRestrictBalanceRequirement;                           // Balance of ERC20 token required by wallet to mint TradeableFlow NFT - not set in constructor (so initially it's zero) but can be adjusted with setters

  // merkle tree root
  bytes32 public immutable root;
    
  struct AffiliateMintingStatus {                                               // Data on permission to mint (whitelisted) and amount minted so far (quantityMinted)
    bool whitelisted;
    uint256 quantityMinted;
  }
  mapping(address => AffiliateMintingStatus) public whitelist;                  // Addresses authorized to mint
  bool public whitelistActive;                                                  // Whether or not whitelist is active
  uint256 public mintLimit = 1;                                                 // Amount of NFTs a whitelisted address is allowed to mint

  string private baseURI;                                                       // Base URI pointing to Drip asset database

  event NewAffiliateLink(uint indexed tokenId, address indexed affiliate);      // Emitted when a new affiliate link is created
  event NewBaseURISet(string baseURI);                                          
  event AppLocked();
  event SetWhiteList(address newMinter, bool status);

  constructor (
    address _owner,
    address _drip,
    string memory _name,
    string memory _symbol,
    string memory _baseURI,
    ISuperfluid host,
    IConstantFlowAgreementV1 cfa,
    int96 _affiliatePortion,
    string memory registrationKey,
     bytes32 _root
  )
    public ERC721 ( _name, _symbol )
    RedirectAll (
      host,
      cfa,
      _owner,
      registrationKey
     )
  { 
    _ap.affiliatePortion = _affiliatePortion;
    owner = _owner;
    drip = _drip;
    baseURI = _baseURI;
    root = _root;
  }

  modifier WhitelistRestriction(bytes32[] calldata merkleProof) {
    
    require(whitelistActive, "mint not actived");
    bytes32 leaf = keccak256(abi.encodePacked(msg.sender));
    require(MerkleProof.verify(merkleProof, root, leaf), "Invalid Proof");
    require( mintLimit > whitelist[msg.sender].quantityMinted, "!mintLimit" );
    whitelist[msg.sender].quantityMinted += 1;
    _;
  }

  /// Must own enough of the designated ERC20 token to mint an affiliate NFT
  modifier ERC20Restriction() {
    if (ERC20MintRestrict != address(0)) {
      require(IERC20(ERC20MintRestrict).balanceOf(msg.sender) >= ERC20MintRestrictBalanceRequirement, "!bal"); 
    }
    _;
  }

  /// Only the Drip 
  modifier onlyAuthorizedLocker() {
    require(msg.sender == drip || msg.sender == _ap.owner, "!auth");
    _;
  }

  /**
  @notice Mints the affiliate NFT
  @param referralCode URI, which also serves as referral code
  @return tokenId Token ID of minted affiliate NFT
  */
  function mint(bytes32[] calldata merkleProof, string memory referralCode) external ERC20Restriction WhitelistRestriction(merkleProof) returns (uint256 tokenId) {
    require(!_ap.locked, "!locked");                                               // Affiliate program shouldn't be locked for minting to occur
    require(msg.sender != _ap.owner, "!own");                                     // Shouldn't be minting affiliate NFTs to contract deployer
    require(_ap.referralcodeToToken[referralCode] == 0, "!uri");                  // prevent minter from minting an NFT with the same affiliate code (tokenURI) as before to prevent affiliate flows from being stolen
    require(keccak256( bytes(referralCode) ) != keccak256( bytes("") ),"blank");  // We don't want to be minting an affiliate NFT with blank referral code

    tokenIds.increment();
    tokenId = tokenIds.current();

    _ap.tokenToReferralCode[tokenId] = referralCode;

    _mint(msg.sender,tokenId);

    // Set msg.sender as affiliate for the token
    _ap.tokenToAffiliate[tokenId] = msg.sender; 

    // Set referral code to corresponding token
    _ap.referralcodeToToken[referralCode] = tokenId;

    // Emit event that NFT was minted
    emit NewAffiliateLink(tokenId, msg.sender);

  }

  /**
  @notice Overrides tokenURI
  @param tokenId token ID of Drip NFT being queried
  @return token URI
  */
  function tokenURI(uint256 tokenId)
      public
      view
      override(ERC721, ERC721URIStorage)
      returns (string memory)
  {
      require(_exists(tokenId),"!exist");
      if (bytes(_baseURI()).length > 0) {
        return string(
              abi.encodePacked(
              _baseURI(),
              "/",
              tokenId.toString()
            )
          );
      } else {
        return "";
      }
  }

  /**
  @dev override for base URI
  @return the variable `baseURI`
  */
  function _baseURI() internal view override returns (string memory) {
      return baseURI;
  }

  /**
  @dev overriding _burn due duplication in inherited ERC721 and ERC721URIStorage
  */
  function _burn(uint256 tokenId) internal override(ERC721, ERC721URIStorage) {
      super._burn(tokenId);
  }

    /**
  @dev overriding supportsInterface due duplication in inherited ERC721 and ERC721URIStorage
  */
  function supportsInterface(bytes4 interfaceId) public view virtual override(ERC721, ERC721Enumerable) returns (bool) {
      super.supportsInterface(interfaceId);
  }

  /**
  @notice Token transfer callback - redirects existing flows to new affiliate
  @dev Redirects flows by calling _changeReceiver function in RedirectAll inheritance. NFT can't be transferred to owner
  @param from original affiliate
  @param to new affiliate
  @param tokenId token ID of affiliate NFT being transferred
  */
  function _beforeTokenTransfer(
    address from,
    address to,
    uint256 tokenId
  ) internal override(ERC721, ERC721Enumerable) {
    require(to != _ap.owner,"!own");

    //this should be added
    super._beforeTokenTransfer(from, to, tokenId);

    if (from != address(0)) {
      _changeReceiver(from, to, tokenId);
    }
  }

  /**
  @notice Sets app to locked. If an owner locks their program, they must notify Drip!
  @notice Drip is allowed to lock the app at discretion as a consequence for not paying for the service
  @dev Setting to true blocks incoming streams and allows anyone to cancel incoming streams
  */
  function lock() external onlyAuthorizedLocker {
    _ap.locked = true;
    emit AppLocked();
  }

  /**
  @notice Sets app to, only Drip can unlock to retain control over monetization
  @dev Setting to true blocks incoming streams and allows anyone to cancel incoming streams
  */
  function unlock() external {
    require(msg.sender == drip, "!drip");
    _ap.locked = false;
  }

  /**
  @notice Sets up whitelist of authorized minters
  @param newMinter new minter authorized to mint an NFT
  @param status new status of minter address
  */
  function setWhiteList(address newMinter, bool status) external onlyOwner {
    require(newMinter != address(0),"!zeroAddr");
    whitelist[newMinter].whitelisted = status;
    emit SetWhiteList(newMinter, status);
  }

  /**
  @notice Switches whitelist restriction statu
  */
  function setWhiteListStatus(bool newStatus, uint256 newMintLimit) external onlyOwner {
    whitelistActive = newStatus;
    mintLimit = newMintLimit;
  }

  /**
  @notice Reset NFT base URIs
  @param newBaseURI new base URI to be used
  */
  function setBaseURI(string memory newBaseURI) external onlyOwner {
      baseURI = newBaseURI;
      emit NewBaseURISet(newBaseURI);
  }

  /**
  @notice Allows owner to set minting restriction based on possession of specified balance of an ERC20 token.
  @param newERC20MintRestrictBalanceRequirement balance of ERC20 token needed to mint affiliate NFT
  @param newERC20MintRestrict ERC20 token required for minting
  */
  function setERC20MintRestriction(
    uint256 newERC20MintRestrictBalanceRequirement,
    address newERC20MintRestrict
  ) external onlyOwner {
    ERC20MintRestrict = newERC20MintRestrict;
    ERC20MintRestrictBalanceRequirement = newERC20MintRestrictBalanceRequirement;
  }

  /**
  @notice Allows owner to set new super token acceptable for payment in affiliate program.
  @notice Setting a token needs a deposit of the new super token from the caller (owner) so app does not become insolvent
  @dev Tokens CANNOT be unset as acceptable
  @param supertoken New super token to be accepted for payment

  IMPORTANT NOTE:
  - When setting new tokens, bear this in mind https://discord.com/channels/752490247643725875/752493348169711696/868658956162203671
  - Simply deposit 4-hours-of-a-100-times-a-max-expected-stream worth of supertoken into the contract to prevent contract malfunction
  */
  function setNewAcceptedToken(
    ISuperToken supertoken
  ) external onlyOwner {
    // Makeshift solution - if the address provided is not a super token, this will error out
    require(_ap.host == ISuperfluid(supertoken.getHost()),"!host");
    // Super token must have not already been set as a valid super token
    require(!_ap.acceptedTokens[supertoken],"alreadyset");
  
    _ap.acceptedTokensList.push(supertoken);
    _ap.acceptedTokens[supertoken] = true;
  }

  /**
  @notice Lets Drip set new monetization authority address
  @param newDrip Address of new monetization authority address
  */
  function setNewDripOwner(
    address newDrip
  ) external {
    require(msg.sender == drip,"!drip");
    drip = newDrip;
  }

  /**
  @notice gets token ID of affiliate NFT that a subscriber was referred with
  @param subscriber Address of subscriber whose associated affiliate NFT is to be discovered
  @return token ID of affiliate NFT associated with the subscriber
  */
  function getAffiliateTokenIdForSubscriber(address subscriber) external view returns (uint256) {
    return _ap.subscribers[subscriber].tokenId;
  }

  /**
  @notice Gets affiliate whose affiliate NFT was used by subscriber for referral
  @dev Links subscriber address to token ID and the to affiliate
  @param subscriber Address of subscriber whose associated affiliate is to be discovered
  @return address of affiliate associated with the subscriber
  */
  function getAffiliateForSubscriber(address subscriber) external view returns (address) {
    return _ap.tokenToAffiliate[_ap.subscribers[subscriber].tokenId];
  }

  /**
  @notice Gets the affiliate associated with an affiliate NFT via token ID
  @param tokenId The token ID of NFT who's associate affiliate is to be discovered
  @return Address of affiliate associated with tokenId
  */
  function getAffiliateFromTokenId(uint256 tokenId) external view returns (address) {
    return _ap.tokenToAffiliate[tokenId];
  }

  /**
  @notice Gets the token a subscriber is paying with
  @param subscriber Address of subscriber
  @return Address of super token the subscriber is paying with
  */
  function getSubscriberPaymentToken(address subscriber) external view returns (address) {
    return address(_ap.subscribers[subscriber].paymentToken);
  }

  /**
  @notice Gets array of accepted tokens
  @return Accepted token list
  */
  function getAcceptedTokensList() external view returns (ISuperToken[] memory) {
    return _ap.acceptedTokensList;
  }

  /**
  @notice Gets outflow associated with a cashflow NFT
  @param tokenId The token ID of NFT who's associated flow is to be discovered
  @param supertoken The supertoken of which the flow is in concern
  @return outflow rate
  */
  function getOutflowFromTokenId(uint256 tokenId, ISuperToken supertoken) external view returns (int96) {
    return _ap.tokenToPaymentTokentoOutflowRate[tokenId][supertoken];
  }

  /**
  @notice Gets token ID associated with a referral code
  @param referralCode The referral code whose associated token ID is in concern
  @return token ID
  */
  function getTokenIdFromAffiliateCode(string memory referralCode) external view returns (uint256) {
    return _ap.referralcodeToToken[referralCode];
  }

  /**
  @notice Gets referral associated with a token Id code
  @param tokenId The token ID whose referral code is in concern
  @return referral code
  */
  function getAffiliateCodeFromTokenId(uint256 tokenId) external view returns (string memory) {
    return _ap.tokenToReferralCode[tokenId];
  }

  /**
  @notice Gets many affiliate codes from many token Ids
  @param tokenIds array of token IDs whos referral codes are in concern
  @return referral codes
  */
  function getAffiliateCodesFromTokenIds(uint256[] memory tokenIds) external view returns (string[] memory) {
    string[] memory referralCodes = new string[](tokenIds.length);

    for (uint tokenId=0; tokenId<tokenIds.length; tokenId++) {
      referralCodes[tokenId]  = _ap.tokenToReferralCode[tokenIds[tokenId]];
    }
  
    return referralCodes;
  }

  /**
  Get all subscribers from a token Id
  @param tokenId token ID whos subscribers are in concern
  @dev parse for and remove even duplicates. zero addresses should also be removed from output
  @return subscribers
  */
  function getSubscribersFromTokenId(uint256 tokenId) external view returns (address[] memory) {

    return _ap.tokenToSubscribers[tokenId].getAllAddresses();

  }

}