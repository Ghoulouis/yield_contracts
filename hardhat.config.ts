import { HardhatUserConfig } from "hardhat/config";
import "hardhat-deploy";
import "@typechain/hardhat";
import "@nomicfoundation/hardhat-chai-matchers";
import "@nomicfoundation/hardhat-network-helpers";
import "@nomicfoundation/hardhat-ethers";
import "hardhat-tracer";
import "hardhat-contract-sizer";
import dotenv from "dotenv";
dotenv.config();

const TEST_HDWALLET = {
  mnemonic: "test test test test test test test test test test test junk",
  path: "m/44'/60'/0'/0",
  initialIndex: 0,
  count: 20,
  passphrase: "",
};

const accounts = [process.env.DEPLOYER!, process.env.TEST_AGENT!];

const { INFURA_KEY } = process.env;

const config: HardhatUserConfig = {
  defaultNetwork: "hardhat",
  networks: {
    hardhat: {
      chainId: 31337,
      gasPrice: 100e9,
      live: false,
      deploy: ["deploy/hardhat"],
    },
    base: {
      url: process.env.BASE_RPC_URL!,
      accounts: accounts,
      live: true,
      deploy: ["deploy/base"],
    },
  },
  solidity: {
    compilers: [
      {
        version: "0.8.24",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
          viaIR: true,
        },
      },
    ],
  },

  mocha: {
    timeout: 200000,
    require: ["dd-trace/ci/init"],
  },
  namedAccounts: {
    deployer: {
      default: 0,
    },
    agent: {
      default: 1,
    },
    beneficiary: {
      default: 2,
    },
  },
};
export default config;
