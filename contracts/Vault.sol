// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC4626Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

import "./interfaces/IStrategy.sol";
import "./interfaces/IAccountant.sol";
import "./interfaces/IDepositLimitModule.sol";
import "./interfaces/IWithdrawLimitModule.sol";

import "hardhat/console.sol";

contract Vault is
    Initializable,
    ERC4626Upgradeable,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable
{
    using SafeERC20 for IERC20;
    using Math for uint256;

    // Constants
    uint256 public constant MAX_QUEUE = 10;
    string public constant API_VERSION = "0.0.1";
    uint256 public constant MAX_PROFIT_UNLOCK_TIME = 365 days;
    uint256 public constant MAX_BPS = 10_000;
    uint256 public constant MAX_BPS_EXTENDED = 1_000_000_000_000;

    // Roles
    address public governance;
    address public agent;
    address public beneficiary;

    modifier onlyGovernance() {
        require(msg.sender == governance, "Not governance");
        _;
    }

    modifier onlyAgent() {
        require(msg.sender == agent, "Not agent");
        _;
    }

    event Deposited(address indexed user, uint256 amount, uint256 shares);
    event RequestedWithdraw(address indexed user, uint256 shares);
    event Withdrawn(
        address indexed user,
        uint256 shares,
        uint256 amount,
        uint256 fee
    );
    event TreasuryTransferred();
    event RateUpdated(uint256 oldRate, uint256 newRate);
    event GovernmentChanged(address newGovernment);
    event AgentChanged(address newAgent);
    event FeeUpdated(uint256 oldFee, uint256 newFee);
    event StrategyChanged(
        address indexed strategy,
        StrategyChangeType changeType
    );
    event StrategyReported(
        address indexed strategy,
        uint256 gain,
        uint256 loss,
        uint256 currentDebt,
        uint256 protocolFees,
        uint256 totalFees,
        uint256 totalRefunds
    );
    event DebtUpdated(
        address indexed strategy,
        uint256 currentDebt,
        uint256 newDebt
    );
    event UpdateAccountant(address indexed accountant);
    event UpdateDepositLimitModule(address indexed depositLimitModule);
    event UpdateWithdrawLimitModule(address indexed withdrawLimitModule);
    event UpdateDefaultQueue(address[] newDefaultQueue);
    event UpdateUseDefaultQueue(bool useDefaultQueue);
    event UpdateAutoAllocate(bool autoAllocate);
    event UpdateDepositLimit(uint256 depositLimit);
    event UpdateMinimumTotalIdle(uint256 minimumTotalIdle);
    event UpdateProfitMaxUnlockTime(uint256 profitMaxUnlockTime);
    event DebtPurchased(address indexed strategy, uint256 amount);

    // Enums
    enum StrategyChangeType {
        ADDED,
        REVOKED
    }

    // Storage
    struct StrategyParams {
        uint256 activation;
        uint256 lastReport;
        uint256 currentDebt;
        uint256 maxDebt;
    }

    // ERC4626
    uint8 public decimalsOffset;

    mapping(address => StrategyParams) public strategies;
    address[] public defaultQueue;
    bool public useDefaultQueue;
    bool public autoAllocate;

    uint256 public totalDebt;
    uint256 public totalIdle;

    // Limits
    uint256 public minimumTotalIdle;
    uint256 public depositLimit;

    // Profit unlocking
    uint256 public profitMaxUnlockTime;
    uint256 public fullProfitUnlockDate;
    uint256 public profitUnlockingRate;
    uint256 public lastProfitUpdate;

    // Fee
    address public accountant;
    uint256 public protocolFeeBps;
    address public protocolFeeRecipient;

    // Modules
    address public depositLimitModule;
    address public withdrawLimitModule;

    // Initializer
    function initialize(
        address _governance,
        address _agent,
        IERC20 _asset,
        string memory _name,
        string memory _symbol,
        uint8 _decimalsOffsetInput,
        uint256 _profitMaxUnlockTime
    ) public initializer {
        require(_governance != address(0), "Zero address: governance");
        require(_agent != address(0), "Zero address: agent");
        require(
            _profitMaxUnlockTime <= MAX_PROFIT_UNLOCK_TIME,
            "Profit unlock time too long"
        );

        __ERC20_init(_name, _symbol);
        __ERC4626_init(_asset);
        __ReentrancyGuard_init();
        __Pausable_init();

        governance = _governance;

        decimalsOffset = _decimalsOffsetInput;
        profitMaxUnlockTime = _profitMaxUnlockTime;
        useDefaultQueue = true;
        depositLimit = type(uint256).max;
    }

    // Override ERC4626 functions
    function _decimalsOffset() internal view override returns (uint8) {
        return decimalsOffset;
    }

    // Override ERC4626 functions
    function maxDeposit(
        address receiver
    ) public view override returns (uint256) {
        if (receiver == address(0) || receiver == address(this) || paused())
            return 0;

        if (depositLimitModule != address(0)) {
            return
                IDepositLimitModule(depositLimitModule).availableDepositLimit(
                    receiver
                );
        }
        if (depositLimit == type(uint256).max) return depositLimit;
        uint256 totalAssets_ = _totalAssets();
        if (totalAssets_ >= depositLimit) return 0;
        return depositLimit - totalAssets_;
    }

    function maxMint(address receiver) public view override returns (uint256) {
        uint256 maxDepositAmount = maxDeposit(receiver);
        if (maxDepositAmount == 0) return 0;
        return convertToShares(maxDepositAmount);
    }

    function deposit(
        uint256 assets,
        address receiver
    ) public override returns (uint256) {
        return super.deposit(assets, receiver);
    }

    function redeem(
        address caller,
        address receiver,
        address owner,
        uint256 shares,
        uint256 maxLoss,
        address[] memory _strategies
    ) public returns (uint256) {
        return _redeem(caller, receiver, owner, shares, maxLoss, _strategies);
    }

    function maxWithdraw(address owner) public view override returns (uint256) {
        return _maxWithdraw(owner, 0, new address[](0));
    }

    function maxWithdraw(
        address owner,
        uint256 maxLoss,
        address[] memory _strategies
    ) public view returns (uint256) {
        return _maxWithdraw(owner, maxLoss, _strategies);
    }

    function _maxWithdraw(
        address owner,
        uint256 maxLoss,
        address[] memory _strategies
    ) internal view returns (uint256) {
        require(maxLoss <= MAX_BPS, "Invalid max loss");
        uint256 maxAssets = convertToAssets(balanceOf(owner));

        if (withdrawLimitModule != address(0)) {
            return
                Math.min(
                    IWithdrawLimitModule(withdrawLimitModule)
                        .availableWithdrawLimit(owner, maxLoss, _strategies),
                    maxAssets
                );
        }

        if (maxAssets <= totalIdle) return maxAssets;

        uint256 have = totalIdle;
        uint256 loss = 0;
        address[] memory queue = useDefaultQueue || _strategies.length == 0
            ? defaultQueue
            : _strategies;

        for (uint256 i = 0; i < queue.length; i++) {
            address strategy = queue[i];
            require(strategies[strategy].activation != 0, "Inactive strategy");

            uint256 currentDebt = strategies[strategy].currentDebt;

            uint256 toWithdraw = Math.min(maxAssets - have, currentDebt);
            if (toWithdraw == 0) continue;

            uint256 unrealisedLoss = _assessShareOfUnrealisedLosses(
                strategy,
                currentDebt,
                toWithdraw
            );

            uint256 strategyLimit = IStrategy(strategy).convertToAssets(
                IStrategy(strategy).maxRedeem(address(this))
            );

            if (strategyLimit < toWithdraw - unrealisedLoss) {
                if (unrealisedLoss != 0) {
                    unrealisedLoss =
                        (unrealisedLoss * strategyLimit) /
                        (toWithdraw - unrealisedLoss);
                }

                toWithdraw = strategyLimit + unrealisedLoss;
            }

            if (unrealisedLoss > 0 && maxLoss < MAX_BPS) {
                if (
                    loss + unrealisedLoss >
                    ((have + toWithdraw) * maxLoss) / MAX_BPS
                ) break;
            }

            have += toWithdraw;
            loss += unrealisedLoss;
            if (have >= maxAssets) break;
        }

        return have;
    }

    function _unlockedShares() internal view returns (uint256) {
        if (fullProfitUnlockDate > block.timestamp) {
            return
                (profitUnlockingRate * (block.timestamp - lastProfitUpdate)) /
                MAX_BPS_EXTENDED;
        } else if (fullProfitUnlockDate != 0) {
            return balanceOf(address(this));
        }
        return 0;
    }

    function totalSupply()
        public
        view
        override(ERC20Upgradeable, IERC20)
        returns (uint256)
    {
        return super.totalSupply() - _unlockedShares();
    }

    function _totalAssets() internal view returns (uint256) {
        return totalIdle + totalDebt;
    }

    function _assessShareOfUnrealisedLosses(
        address strategy,
        uint256 strategyCurrentDebt,
        uint256 assetsNeeded
    ) internal view returns (uint256) {
        uint256 vaultShares = IStrategy(strategy).balanceOf(address(this));
        uint256 strategyAssets = IStrategy(strategy).convertToAssets(
            vaultShares
        );
        if (strategyAssets >= strategyCurrentDebt || strategyCurrentDebt == 0)
            return 0;

        uint256 numerator = assetsNeeded * strategyAssets;
        uint256 usersShareOfLoss = assetsNeeded -
            (numerator / strategyCurrentDebt);
        if (numerator % strategyCurrentDebt != 0) usersShareOfLoss += 1;
        return usersShareOfLoss;
    }

    function _withdrawFromStrategy(
        address strategy,
        uint256 assetsToWithdraw
    ) internal {
        uint256 sharesToRedeem = Math.min(
            IStrategy(strategy).previewWithdraw(assetsToWithdraw),
            IStrategy(strategy).balanceOf(address(this))
        );
        IStrategy(strategy).redeem(
            sharesToRedeem,
            address(this),
            address(this)
        );
    }

    function _deposit(
        address caller,
        address receiver,
        uint256 assets,
        uint256 shares
    ) internal override {
        require(assets <= maxDeposit(receiver), "Exceed deposit limit");
        require(shares > 0, "Cannot mint zero");

        IERC20(asset()).safeTransferFrom(caller, address(this), assets);
        totalIdle += assets;
        _mint(receiver, shares);

        if (autoAllocate && defaultQueue.length > 0) {
            _updateDebt(defaultQueue[0], type(uint256).max, 0);
        }

        emit Deposited(receiver, assets, shares);
    }

    function redeem(
        uint256 shares,
        address receiver,
        address owner
    ) public override returns (uint256) {
        return
            _redeem(_msgSender(), receiver, owner, shares, 0, new address[](0));
    }

    function _redeem(
        address caller,
        address receiver,
        address owner,
        uint256 shares,
        uint256 maxLoss,
        address[] memory _strategies
    ) internal returns (uint256) {
        require(!paused(), "Vault paused");
        require(receiver != address(0), "Zero address");
        require(shares > 0, "No shares to redeem");
        require(maxLoss <= MAX_BPS, "Invalid max loss");
        require(balanceOf(owner) >= shares, "Insufficient shares");

        if (caller != owner) {
            _spendAllowance(owner, caller, shares);
        }

        uint256 assets = convertToAssets(shares);
        uint256 requestedAssets = assets;

        if (withdrawLimitModule != address(0)) {
            require(
                assets <=
                    IWithdrawLimitModule(withdrawLimitModule)
                        .availableWithdrawLimit(owner, maxLoss, _strategies),
                "Exceed withdraw limit"
            );
        }

        uint256 currentTotalIdle = totalIdle;
        address _asset = asset();

        if (requestedAssets > currentTotalIdle) {
            address[] memory queue = useDefaultQueue || _strategies.length == 0
                ? defaultQueue
                : _strategies;
            uint256 assetsNeeded = requestedAssets - currentTotalIdle;
            uint256 currentTotalDebt = totalDebt;
            uint256 previousBalance = IERC20(_asset).balanceOf(address(this));

            uint256 currentDebt;
            uint256 assetsToWithdraw;
            uint256 maxAssetsCanWithdraw;
            uint256 unrealisedLoss;

            for (uint256 i = 0; i < queue.length; i++) {
                address strategy = queue[i];

                (
                    assetsNeeded,
                    requestedAssets,
                    currentTotalDebt,
                    unrealisedLoss
                ) = _redeemHelper(
                    strategy,
                    assetsNeeded,
                    requestedAssets,
                    currentTotalDebt
                );

                assetsToWithdraw = Math.min(
                    assetsToWithdraw,
                    maxAssetsCanWithdraw
                );

                if (assetsToWithdraw == 0) continue;

                _withdrawFromStrategy(strategy, assetsToWithdraw);

                uint256 postBalance = IERC20(_asset).balanceOf(address(this));
                uint256 withdrawn = Math.min(
                    postBalance - previousBalance,
                    currentDebt
                );
                uint256 loss = assetsToWithdraw > withdrawn
                    ? assetsToWithdraw - withdrawn
                    : 0;

                currentTotalIdle += (assetsToWithdraw - loss);
                requestedAssets -= loss;
                currentTotalDebt -= assetsToWithdraw;

                uint256 newDebt = currentDebt -
                    (assetsToWithdraw + unrealisedLoss);
                strategies[strategy].currentDebt = newDebt;
                emit DebtUpdated(strategy, currentDebt, newDebt);

                if (requestedAssets <= currentTotalIdle) break;
                previousBalance = postBalance;
                assetsNeeded -= assetsToWithdraw;
            }

            require(
                currentTotalIdle >= requestedAssets,
                "Insufficient assets to withdraw"
            );
            totalDebt = currentTotalDebt;
        }

        if (assets > requestedAssets && maxLoss < MAX_BPS) {
            require(
                assets - requestedAssets <= (assets * maxLoss) / MAX_BPS,
                "Too much loss"
            );
        }

        _burn(owner, shares);
        totalIdle -= requestedAssets;
        IERC20(_asset).safeTransfer(receiver, requestedAssets);

        emit Withdrawn(owner, shares, requestedAssets, 0);
        return requestedAssets;
    }

    function _redeemHelper(
        address strategy,
        uint256 assetsNeeded,
        uint256 requestedAssets,
        uint256 currentTotalDebt
    ) internal returns (uint256, uint256, uint256, uint256) {
        require(strategies[strategy].activation != 0, "Inactive strategy");
        uint256 currentDebt = strategies[strategy].currentDebt;
        uint256 assetsToWithdraw = Math.min(assetsNeeded, currentDebt);
        uint256 maxAssetsCanWithdraw = IStrategy(strategy).convertToAssets(
            IStrategy(strategy).maxRedeem(address(this))
        );
        console.log("assetsToWithdraw", assetsToWithdraw);
        console.log("maxAssetsCanWithdraw", maxAssetsCanWithdraw);

        uint256 unrealisedLoss = _assessShareOfUnrealisedLosses(
            strategy,
            currentDebt,
            assetsToWithdraw
        );

        if (unrealisedLoss > 0) {
            if (maxAssetsCanWithdraw < assetsToWithdraw - unrealisedLoss) {
                unrealisedLoss =
                    (unrealisedLoss * maxAssetsCanWithdraw) /
                    (assetsToWithdraw - unrealisedLoss);
                assetsToWithdraw = maxAssetsCanWithdraw + unrealisedLoss;
            }
            assetsToWithdraw -= unrealisedLoss;
            requestedAssets -= unrealisedLoss;
            assetsNeeded -= unrealisedLoss;
            currentTotalDebt -= unrealisedLoss;

            if (maxAssetsCanWithdraw == 0 && unrealisedLoss > 0) {
                strategies[strategy].currentDebt = currentDebt - unrealisedLoss;
                emit DebtUpdated(
                    strategy,
                    currentDebt,
                    strategies[strategy].currentDebt
                );
            }
        }

        return (
            assetsNeeded,
            requestedAssets,
            currentTotalDebt,
            unrealisedLoss
        );
    }

    function _processReport(
        address strategy
    ) internal nonReentrant returns (uint256 gain, uint256 loss) {
        require(strategy != address(this), "Invalid strategy");

        require(strategies[strategy].activation != 0, "Inactive strategy");

        address _asset = asset();
        uint256 __totalAssets;
        uint256 __currentDebt;

        if (strategy != address(this)) {
            require(strategies[strategy].activation != 0, "Inactive strategy");
            uint256 strategyShares = IStrategy(strategy).balanceOf(
                address(this)
            );
            __totalAssets = IStrategy(strategy).convertToAssets(strategyShares);
            __currentDebt = strategies[strategy].currentDebt;
        } else {
            __totalAssets = IERC20(_asset).balanceOf(address(this));
            __currentDebt = totalIdle;
        }

        if (__totalAssets > __currentDebt) {
            gain = __totalAssets - __currentDebt;
        } else {
            loss = __currentDebt - __totalAssets;
        }

        uint256 totalFees;
        uint256 totalRefunds;

        if (accountant != address(0)) {
            (totalFees, totalRefunds) = IAccountant(accountant).report(
                strategy,
                gain,
                loss
            );

            totalRefunds = Math.min(
                totalRefunds,
                Math.min(
                    IERC20(_asset).balanceOf(accountant),
                    IERC20(_asset).allowance(accountant, address(this))
                )
            );
        }

        uint256 totalFeesShares;
        uint256 protocolFeesShares;

        uint256 sharesToBurn;
        if (loss + totalFees > 0) {
            sharesToBurn = convertToShares(loss + totalFees);
            if (totalFees > 0) {
                totalFeesShares =
                    (sharesToBurn * totalFees) /
                    (loss + totalFees);
                if (protocolFeeBps > 0) {
                    protocolFeesShares =
                        (totalFeesShares * protocolFeeBps) /
                        MAX_BPS;
                }
            }
        }

        uint256 sharesToLock;
        if (gain + totalRefunds > 0 && profitMaxUnlockTime != 0) {
            sharesToLock = convertToShares(gain + totalRefunds);
        }

        uint256 totalSupply_ = totalSupply();
        uint256 totalLockedShares_ = balanceOf(address(this));
        uint256 endingSupply = totalSupply_ +
            sharesToLock -
            sharesToBurn -
            _unlockedShares();

        if (endingSupply > totalSupply_) {
            _mint(address(this), endingSupply - totalSupply_);
        } else if (totalSupply_ > endingSupply) {
            uint256 toBurn = Math.min(
                totalSupply_ - endingSupply,
                totalLockedShares_
            );
            _burn(address(this), toBurn);
        }

        if (sharesToLock > sharesToBurn) {
            sharesToLock -= sharesToBurn;
        } else {
            sharesToLock = 0;
        }

        if (totalRefunds > 0) {
            IERC20(_asset).safeTransferFrom(
                accountant,
                address(this),
                totalRefunds
            );
            totalIdle += totalRefunds;
        }

        if (gain > 0) {
            __currentDebt += gain;
            if (strategy != address(this)) {
                strategies[strategy].currentDebt = __currentDebt;
                totalDebt += gain;
            } else {
                __currentDebt += totalRefunds;
                totalIdle = __currentDebt;
            }
        } else if (loss > 0) {
            __currentDebt -= loss;
            if (strategy != address(this)) {
                strategies[strategy].currentDebt = __currentDebt;
                totalDebt -= loss;
            } else {
                __currentDebt += totalRefunds;
                totalIdle = __currentDebt;
            }
        }

        if (totalFeesShares > 0) {
            _mint(beneficiary, totalFeesShares - protocolFeesShares);
            if (protocolFeesShares > 0) {
                _mint(protocolFeeRecipient, protocolFeesShares);
            }
        }

        totalLockedShares_ = balanceOf(address(this));
        if (totalLockedShares_ > 0) {
            uint256 previouslyLockedTime;
            if (fullProfitUnlockDate > block.timestamp) {
                previouslyLockedTime =
                    (totalLockedShares_ - sharesToLock) *
                    (fullProfitUnlockDate - block.timestamp);
            }
            uint256 newProfitLockingPeriod = (previouslyLockedTime +
                sharesToLock *
                profitMaxUnlockTime) / totalLockedShares_;
            profitUnlockingRate =
                (totalLockedShares_ * MAX_BPS_EXTENDED) /
                newProfitLockingPeriod;
            fullProfitUnlockDate = block.timestamp + newProfitLockingPeriod;
            lastProfitUpdate = block.timestamp;
        } else {
            fullProfitUnlockDate = 0;
        }

        strategies[strategy].lastReport = block.timestamp;

        if (
            loss + totalFees > gain + totalRefunds || profitMaxUnlockTime == 0
        ) {
            totalFees = convertToAssets(totalFeesShares);
        }

        emit StrategyReported(
            strategy,
            gain,
            loss,
            __currentDebt,
            protocolFeesShares,
            totalFees,
            totalRefunds
        );

        return (gain, loss);
    }

    function _updateDebt(
        address strategy,
        uint256 targetDebt,
        uint256 maxLoss
    ) internal nonReentrant whenNotPaused returns (uint256) {
        require(strategies[strategy].activation != 0, "Inactive strategy");

        uint256 currentDebt = strategies[strategy].currentDebt;
        require(targetDebt != currentDebt, "No debt change");

        if (currentDebt > targetDebt) {
            uint256 assetsToWithdraw = currentDebt - targetDebt;
            if (totalIdle + assetsToWithdraw < minimumTotalIdle) {
                assetsToWithdraw = minimumTotalIdle > totalIdle
                    ? minimumTotalIdle - totalIdle
                    : 0;
                assetsToWithdraw = Math.min(assetsToWithdraw, currentDebt);
            }

            uint256 withdrawable = IStrategy(strategy).convertToAssets(
                IStrategy(strategy).maxRedeem(address(this))
            );

            assetsToWithdraw = Math.min(assetsToWithdraw, withdrawable);
            require(
                _assessShareOfUnrealisedLosses(
                    strategy,
                    currentDebt,
                    assetsToWithdraw
                ) == 0,
                "Unrealised losses"
            );

            if (assetsToWithdraw == 0) return currentDebt;

            uint256 preBalance = IERC20(asset()).balanceOf(address(this));
            _withdrawFromStrategy(strategy, assetsToWithdraw);
            uint256 postBalance = IERC20(asset()).balanceOf(address(this));
            uint256 withdrawn = Math.min(postBalance - preBalance, currentDebt);

            if (withdrawn < assetsToWithdraw && maxLoss < MAX_BPS) {
                require(
                    (assetsToWithdraw - withdrawn) <=
                        (assetsToWithdraw * maxLoss) / MAX_BPS,
                    "Too much loss"
                );
            } else if (withdrawn > assetsToWithdraw) {
                assetsToWithdraw = withdrawn;
            }

            totalIdle += withdrawn;
            totalDebt -= assetsToWithdraw;
            uint256 newDebt = currentDebt - assetsToWithdraw;

            strategies[strategy].currentDebt = newDebt;
            emit DebtUpdated(strategy, currentDebt, newDebt);
            return newDebt;
        } else {
            uint256 maxDebt = strategies[strategy].maxDebt;
            uint256 newDebt = Math.min(targetDebt, maxDebt);
            if (newDebt <= currentDebt) return currentDebt;

            uint256 _maxDeposit = IStrategy(strategy).maxDeposit(address(this));
            if (_maxDeposit == 0) return currentDebt;

            uint256 assetsToDeposit = newDebt - currentDebt;
            assetsToDeposit = Math.min(assetsToDeposit, _maxDeposit);
            if (totalIdle <= minimumTotalIdle) return currentDebt;
            assetsToDeposit = Math.min(
                assetsToDeposit,
                totalIdle - minimumTotalIdle
            );

            if (assetsToDeposit > 0) {
                address _asset = asset();
                IERC20(_asset).approve(strategy, assetsToDeposit);
                uint256 preBalance = IERC20(_asset).balanceOf(address(this));

                IStrategy(strategy).deposit(assetsToDeposit, address(this));
                uint256 postBalance = IERC20(_asset).balanceOf(address(this));
                IERC20(_asset).approve(strategy, 0);
                assetsToDeposit = preBalance - postBalance;
                totalIdle -= assetsToDeposit;
                totalDebt += assetsToDeposit;
            }

            newDebt = currentDebt + assetsToDeposit;
            strategies[strategy].currentDebt = newDebt;
            emit DebtUpdated(strategy, currentDebt, newDebt);
            return newDebt;
        }
    }

    // Governance Functions

    function setDefaultQueue(
        address[] calldata newDefaultQueue
    ) public onlyGovernance {
        require(newDefaultQueue.length <= MAX_QUEUE, "Queue too long");
        for (uint256 i = 0; i < newDefaultQueue.length; i++) {
            require(
                strategies[newDefaultQueue[i]].activation != 0,
                "Inactive strategy"
            );
        }
        defaultQueue = newDefaultQueue;
        emit UpdateDefaultQueue(newDefaultQueue);
    }

    function setUseDefaultQueue(bool useDefaultQueue_) public onlyGovernance {
        useDefaultQueue = useDefaultQueue_;
        emit UpdateUseDefaultQueue(useDefaultQueue_);
    }

    function setAutoAllocate(bool autoAllocate_) public onlyGovernance {
        autoAllocate = autoAllocate_;
        emit UpdateAutoAllocate(autoAllocate_);
    }

    // Strategy Management
    function addStrategy(
        address newStrategy,
        bool addToQueue
    ) public onlyGovernance {
        require(
            newStrategy != address(0) && newStrategy != address(this),
            "Invalid strategy"
        );
        require(IStrategy(newStrategy).asset() == asset(), "Invalid asset");
        require(
            strategies[newStrategy].activation == 0,
            "Strategy already active"
        );

        strategies[newStrategy] = StrategyParams({
            activation: block.timestamp,
            lastReport: block.timestamp,
            currentDebt: 0,
            maxDebt: 0
        });

        if (addToQueue && defaultQueue.length < MAX_QUEUE) {
            defaultQueue.push(newStrategy);
        }

        emit StrategyChanged(newStrategy, StrategyChangeType.ADDED);
    }

    function revokeStrategy(address strategy, bool force) internal {
        require(strategies[strategy].activation != 0, "Strategy not active");

        if (strategies[strategy].currentDebt != 0) {
            require(force, "Strategy has debt");
            uint256 loss = strategies[strategy].currentDebt;
            totalDebt -= loss;
            emit StrategyReported(strategy, 0, loss, 0, 0, 0, 0);
        }

        delete strategies[strategy];

        address[] memory newQueue = new address[](MAX_QUEUE);
        uint256 index = 0;
        for (uint256 i = 0; i < defaultQueue.length; i++) {
            if (defaultQueue[i] != strategy) {
                newQueue[index] = defaultQueue[i];
                index++;
            }
        }

        assembly {
            mstore(newQueue, index)
        }
        defaultQueue = newQueue;

        emit StrategyChanged(strategy, StrategyChangeType.REVOKED);
    }

    function revokeStrategy(address strategy) public onlyGovernance {
        revokeStrategy(strategy, false);
    }

    function forceRevokeStrategy(address strategy) public onlyGovernance {
        revokeStrategy(strategy, true);
    }

    function updateMaxDebtForStrategy(
        address strategy,
        uint256 newMaxDebt
    ) public onlyGovernance {
        require(strategies[strategy].activation != 0, "Inactive strategy");
        strategies[strategy].maxDebt = newMaxDebt;
        emit DebtUpdated(
            strategy,
            strategies[strategy].currentDebt,
            newMaxDebt
        );
    }

    // Debt Management
    function updateDebt(
        address strategy,
        uint256 targetDebt,
        uint256 maxLoss
    ) public onlyGovernance returns (uint256) {
        return _updateDebt(strategy, targetDebt, maxLoss);
    }

    function setDepositLimit(uint256 newDepositLimit) public onlyGovernance {
        depositLimit = newDepositLimit;
        emit UpdateDepositLimit(depositLimit);
    }

    function setDepositLimitModule(
        address newDepositLimitModule
    ) public onlyGovernance {
        depositLimitModule = newDepositLimitModule;
        emit UpdateDepositLimitModule(depositLimitModule);
    }

    function setMinimumTotalIdle(
        uint256 newMinimumTotalIdle
    ) public onlyGovernance {
        minimumTotalIdle = newMinimumTotalIdle;
        emit UpdateMinimumTotalIdle(minimumTotalIdle);
    }

    function setAccountant(address newAccountant) public onlyGovernance {
        accountant = newAccountant;
        emit UpdateAccountant(accountant);
    }

    // Emergency Management
    function shutdownVault() public onlyGovernance {
        depositLimit = 0;
        _pause();
        emit UpdateDepositLimit(0);
    }

    // Reporting Management
    function processReport(
        address strategy
    ) public onlyGovernance returns (uint256, uint256) {
        return _processReport(strategy);
    }

    function buyDebt(
        address strategy,
        uint256 amount
    ) public nonReentrant onlyGovernance {
        require(strategies[strategy].activation != 0, "Not active");
        uint256 currentDebt = strategies[strategy].currentDebt;
        require(currentDebt > 0 && amount > 0, "Nothing to buy");

        uint256 _amount = Math.min(amount, currentDebt);
        uint256 shares = (IStrategy(strategy).balanceOf(address(this)) *
            _amount) / currentDebt;

        require(shares > 0, "Cannot buy zero");
        IERC20(asset()).safeTransferFrom(msg.sender, address(this), _amount);
        strategies[strategy].currentDebt -= _amount;
        totalDebt -= _amount;
        totalIdle += _amount;
        IERC20(strategy).safeTransfer(msg.sender, shares);

        emit DebtUpdated(
            strategy,
            currentDebt,
            strategies[strategy].currentDebt
        );
        emit DebtPurchased(strategy, _amount);
    }

    // View Functions
    function totalAssets() public view override returns (uint256) {
        return _totalAssets();
    }

    function unlockedShares() public view returns (uint256) {
        return _unlockedShares();
    }

    function pricePerShare() public view returns (uint256) {
        return convertToAssets(10 ** decimals());
    }

    function maxRedeem(
        address owner,
        uint256 maxLoss,
        address[] memory _strategies
    ) public view returns (uint256) {
        return
            Math.min(
                convertToShares(_maxWithdraw(owner, maxLoss, _strategies)),
                balanceOf(owner)
            );
    }

    function assessShareOfUnrealisedLosses(
        address strategy,
        uint256 assetsNeeded
    ) public view returns (uint256) {
        uint256 currentDebt = strategies[strategy].currentDebt;
        require(currentDebt >= assetsNeeded, "Invalid assets needed");
        return
            _assessShareOfUnrealisedLosses(strategy, currentDebt, assetsNeeded);
    }

    function _convertToAssets(
        uint256 shares,
        Math.Rounding rounding
    ) internal view override returns (uint256) {
        if (shares == type(uint256).max || shares == 0) {
            return shares / 10 ** _decimalsOffset();
        }
        uint256 totalSupply_ = totalSupply();
        uint256 totalAssets_ = totalAssets();
        if (totalSupply_ == 0) {
            return shares / 10 ** _decimalsOffset();
        }
        uint256 numerator = shares * totalAssets_;
        uint256 amount = numerator / totalSupply_;
        if (rounding == Math.Rounding.Ceil && numerator % totalSupply_ != 0) {
            amount++;
        }
        return amount;
    }

    function _convertToShares(
        uint256 assets,
        Math.Rounding rounding
    ) internal view override returns (uint256) {
        if (assets == type(uint256).max || assets == 0) {
            return assets * 10 ** _decimalsOffset();
        }
        uint256 totalSupply_ = totalSupply();
        uint256 totalAssets_ = totalAssets();
        if (totalSupply_ == 0) {
            return assets * 10 ** _decimalsOffset();
        }
        uint256 numerator = assets * totalSupply_;
        uint256 shares = numerator / totalAssets_;
        if (rounding == Math.Rounding.Ceil && numerator % totalAssets_ != 0) {
            shares++;
        }
        return shares;
    }
}
