import { ethers } from "hardhat";

async function generateECDSAKeyPair() {
  const wallet = ethers.Wallet.createRandom();
  console.log("Private Key:", wallet.privateKey);
  console.log("Public Key:", wallet.address);
}

generateECDSAKeyPair();
