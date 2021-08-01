//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
pragma abicoder v2;

import "hardhat/console.sol";

import {RedirectAll, ISuperToken, IConstantFlowAgreementV1, ISuperfluid} from "./RedirectAll.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/Counters.sol";
import {TradeableFlowStorage} from "./TradeableFlowStorage.sol";


contract TradeableFlow is ERC721, ERC721URIStorage, RedirectAll {

  using Counters for Counters.Counter;
  Counters.Counter tokenIds;
  // using TradeableFlowStorage for TradeableFlowStorage.Link;

  event NewAffiliateLink(uint tokenId, address owner);      // Emitted when a new affiliate link is created

  address public owner;
  address public ERC20Restrict;                       // ERC20 token for which you must have enough balance to mint TradeableFlow NFT
  uint256 public ERC20RestrictBalanceRequirement;     // Balance of ERC20 token required by wallet to mint TradeableFlow NFT
  bool public tokenRestriction;                       // Whether or not minting TradeableFlow NFT is to be restricted based on user's balance of 

  constructor (
    address _owner,
    string memory _name,
    string memory _symbol,
    ISuperfluid host,
    IConstantFlowAgreementV1 cfa,
    ISuperToken acceptedToken,
    address _ERC20Restrict,
    bool _tokenRestriction,
    int96 _affiliatePortion
  )
    public ERC721 ( _name, _symbol )
    RedirectAll (
      host,
      cfa,
      acceptedToken,
      _owner
     )
  { 
    ERC20Restrict = _ERC20Restrict;
    tokenRestriction = _tokenRestriction;
    owner = _owner;
    _ap.affiliatePortion = _affiliatePortion;
  }

  modifier hasEnoughERC20Restrict() {
    if (tokenRestriction) {
      require(IERC20(ERC20Restrict).balanceOf(msg.sender) >= ERC20RestrictBalanceRequirement, "!bal"); // You do not own enough of the designated ERC20 token to mint an affiliate NFT
    }
    _;
  }

  modifier isOwner() {
    require(msg.sender == owner,"!own");
    _;
  }

  // @dev Potential affiliate will call this function if they want an NFT for themself
  // @notice on dApp, when minting, tokenURI will be a randomly generated aquatic mammal word concatenation 
  function mint(string memory tokenURI) public hasEnoughERC20Restrict returns (uint256 tokenId) {
    require(msg.sender != _ap.owner, "!own"); // Shouldn't be minting affiliate NFTs to contract deployer

    tokenIds.increment();
    tokenId = tokenIds.current();

    _mint(msg.sender,tokenId);
    _setTokenURI(tokenId,tokenURI); 

    // Set msg.sender as affiliate for the token
    _ap.tokenToAffiliate[tokenId] = msg.sender; 

    // Set referral code to corresponding token
    _ap.referralcodeToToken[tokenURI] = tokenId;

    // Initialize affiliate in affiliateToOutflow
    _ap.affiliateToOutflow[msg.sender] = 0;

  }

  

  function _beforeTokenTransfer(
    address from,
    address to,
    uint256 tokenId
  ) internal override {
      if (from != address(0)) {
        _changeReceiver(from, to, tokenId);
      }
  }

  function _burn(uint256 tokenId) internal override(ERC721, ERC721URIStorage) {
      super._burn(tokenId);
  }

  function tokenURI(uint256 tokenId)
      public
      view
      override(ERC721, ERC721URIStorage)
      returns (string memory)
  {
      return super.tokenURI(tokenId);
  }

  // @notice We are not letting the program owner change the ERC20Restrict (just saving space)
  function changeSettings(
    uint256 newERC20RestrictBalanceRequirement,
    bool newtokenRestriction
  ) public isOwner {
    ERC20RestrictBalanceRequirement = newERC20RestrictBalanceRequirement;
    tokenRestriction = newtokenRestriction;
  }

  // function getERC20RestrictBalanceRequirement() external view returns (uint256) {
  //   return ERC20RestrictBalanceRequirement;
  // }

  // function getTokenRestriction() external view returns (bool) {
  //   return tokenRestriction;
  // }

}