<h1> OmniFarming V2 Technical Paper </h1>

_A solidity forked from [Yearn V3](https://github.com/yearn/yearn-vaults-v3/blob/master/contracts/VaultV3.vy)_

- [Mechanism](#mechanism)

  - [Strategies Mechanism](#strategies-mechanism)
  - [Auto Allocate Mechanism](#auto-allocate-mechanism)
  - [Reward Mechanism](#reward-mechanism)
  - [Fee Mechanism](#fee-mechanism)
  - [Limit Mechanism](#limit-mechanism)
  - [Unrealised Losses Mechanism](#unrealised-losses-mechanism)
  - [Buy Debt Mechanism](#buy-debt-mechanism)

- [Function](#function)
  - [Deposit](#deposit)
  - [Withdraw](#withdraw)
  - [Report](#report)

# mechanism

### Strategies Mechanism

- Mô tả chức năng strategies: thêm, xoá strategy, quản lí nợ, cập nhật max nợ 
+ Yêu cầu phải có role: QUEUE_MANAGER thì mới có thể thêm, xóa strategy, quản lí nợ, cập nhật max nợ.
1) Thêm strategy: Thêm một strategy vào `default_queue` để vault có thể phân bố tài sản vào đó.
2) Xóa strategy: Xóa một strategy khỏi `default_queue`, ngăn nó nhận thêm tài sản.
3) Quản lí nợ: gồm `ExecuteUpdateMaxDebtForStrategy`: Cập nhật max nợ cho strategy, giới hạn lượng tài sản strategy có thể vay. 
- Giải thích chức năng của Queue trong cơ chế này:
+ Chức năng Queue trong OmniFarmingV2 khá hay, mình có thể tưởng tượng như nó giống như hàng đợi ưu tiên của các Strategy, khi Vault tự động gửi tài sản vào strategy đầu tiên trong `default_queue` khi người dùng deposit/mint, rất tiện nếu người dùng muốn farm tối ưu lợi nhuận.
+ Mỗi strategy là 1 vault ERC4626, `QUEUE_MANAGER` có thể sắp xếp, thêm, hoặc xóa strategy trong hàng đợi để điều chỉnh chiến lược đầu tư.
TH đặc biệt: Strategy có thể bị inactive thì nó coi như out khỏi `default_queue` cho đến khi được active trở lại.
### Auto Allocate Mechanism
   -  Cơ chế Auto Allocate trong OmniFarmingV2 là cơ chế tự động phân bố tài sản khi deposit/mint. Một cơ chế rất tiện lợi khi vault có thể tự re-balance current_debt về target debt bằng cách gửi hoặc rút tài sản từ strategy(target_debt sẽ phải nhỏ hơn hoặc bằng Strategy's max debt)
   - Khi autoAllocate = true thì vault sẽ tự động phân bố tài sản gửi vào thông qua hàm deposit vào strategy đàu tiên trong hàng dợi miễn là các điều kiện về maxDebt, maxDeposit, miniumTotalIdle được đáp ứng.
   - Trong đó:
   -  Tài sản gửi vào strategy sẽ được lấy từ tài sản "idle" của vaut(totalIdle). Đây là số tài sản mà vault đang giữ (thường là token như USDC) trong hợp đồng vault, chưa được phân bổ vào bất kỳ strategy nào.
    -  Tài sản được rút từ strategy. Strategy trả lại tài sản cho vault dựa trên số lượng có thể rút (maxRedeem) và trạng thái tài sản (có thể bị khóa hoặc không).(bị khóa thì k rút - TH đặc biệt)
   - Cơ chế này sẽ so sánh current_debt với target_debt và take funds hoặc deposit một lượng fund mới cho strategy. Khi đó, strategy có thể yêu cầu một lượng maxium funds mà nó muốn nhận để invest và strategy cũng có thể từ chối freeing funds nếu funds đó đang bị khóa( trường hợp đặc biệt).
   ```solidity
    function ExecuteUpdateDebt(
        DataTypes.VaultData storage vault,
        address strategy,
        uint256 targetDebt,
        uint256 maxLoss
    ) external returns (uint256) {
        require(
            vault.strategies[strategy].activation != 0,
            "Inactive strategy"
        );

        uint256 currentDebt = vault.strategies[strategy].currentDebt;
        require(targetDebt != currentDebt, "No debt change");

        if (currentDebt > targetDebt) {
            uint256 assetsToWithdraw = currentDebt - targetDebt;
            if (vault.totalIdle + assetsToWithdraw < vault.minimumTotalIdle) {
                assetsToWithdraw = vault.minimumTotalIdle > vault.totalIdle
                    ? vault.minimumTotalIdle - vault.totalIdle
                    : 0;
                assetsToWithdraw = Math.min(assetsToWithdraw, currentDebt);
            }

            uint256 withdrawable = IStrategy(strategy).convertToAssets(
                IStrategy(strategy).maxRedeem(address(this))
            );

            assetsToWithdraw = Math.min(assetsToWithdraw, withdrawable);
            require(
                UnrealisedLossesLogic._assessShareOfUnrealisedLosses(
                    strategy,
                    currentDebt,
                    assetsToWithdraw
                ) == 0,
                "Unrealised losses"
            );

            if (assetsToWithdraw == 0) return currentDebt;

            uint256 preBalance = IERC20(vault.asset()).balanceOf(address(this));
            WithdrawFromStrategyLogic._withdrawFromStrategy(
                vault,
                strategy,
                assetsToWithdraw
            );
            uint256 postBalance = IERC20(vault.asset()).balanceOf(
                address(this)
            );
            uint256 withdrawn = Math.min(postBalance - preBalance, currentDebt);

            if (withdrawn < assetsToWithdraw && maxLoss < Constants.MAX_BPS) {
                require(
                    (assetsToWithdraw - withdrawn) <=
                        (assetsToWithdraw * maxLoss) / Constants.MAX_BPS,
                    "Too much loss"
                );
            } else if (withdrawn > assetsToWithdraw) {
                assetsToWithdraw = withdrawn;
            }

            vault.totalIdle += withdrawn;
            vault.totalDebt -= assetsToWithdraw;
            uint256 newDebt = currentDebt - assetsToWithdraw;

            vault.strategies[strategy].currentDebt = newDebt;
            emit IVault.DebtUpdated(strategy, currentDebt, newDebt);
            return newDebt;
        } else {
            uint256 maxDebt = vault.strategies[strategy].maxDebt;
            uint256 newDebt = Math.min(targetDebt, maxDebt);
            if (newDebt <= currentDebt) return currentDebt;

            uint256 _maxDeposit = IStrategy(strategy).maxDeposit(address(this));
            if (_maxDeposit == 0) return currentDebt;

            uint256 assetsToDeposit = newDebt - currentDebt;
            assetsToDeposit = Math.min(assetsToDeposit, _maxDeposit);
            if (vault.totalIdle <= vault.minimumTotalIdle) return currentDebt;
            assetsToDeposit = Math.min(
                assetsToDeposit,
                vault.totalIdle - vault.minimumTotalIdle
            );

            if (assetsToDeposit > 0) {
                address _asset = vault.asset();
                IERC20(_asset).approve(strategy, assetsToDeposit);
                uint256 preBalance = IERC20(_asset).balanceOf(address(this));

                IStrategy(strategy).deposit(assetsToDeposit, address(this));
                uint256 postBalance = IERC20(_asset).balanceOf(address(this));
                IERC20(_asset).approve(strategy, 0);
                assetsToDeposit = preBalance - postBalance;
                vault.totalIdle -= assetsToDeposit;
                vault.totalDebt += assetsToDeposit;
            }

            newDebt = currentDebt + assetsToDeposit;
            vault.strategies[strategy].currentDebt = newDebt;
            emit IVault.DebtUpdated(strategy, currentDebt, newDebt);
            return newDebt;
        }
    }
   ```
### Reward Mechanism

Cơ chế trả phần trưởng trong OmniFarming V2 khá đặc biệt, 1 strategy khi tích hợp có thể mang lại lãi hoặc lỗ tuỳ thời điểm được báo cáo.

- Trường hợp lãi, lãi sẽ được vesting dần thông qua đường cong dựa trên `profitMaxUnlockTime` theo đơn vị giây

- Trường hợp lỗ, vault sẽ cập nhật tổn thất ngay lập tức, trước tiên là giảm lợi nhuận đang vesting từ báo cáo trước đó, sau đó là giảm pps.

### Fee Mechanism

OmniFarming V2 thu 2 loại phí, bao gồm:

- Management Fee: 1% 1 năm trên fund
- Performance Fee: 10% trên profit

**Management Fee**

Mint lượng lp tương ứng giữa 2 lần deposit/withdraw dựa trên **tổng số thanh khoản của user**,
Override các hàm `PreviewMint` `PreviewWithdraw` `PreviewDeposit` `PreviewRedeem` theo công thức mới có tính trước management Fee vào totalSupply

**Performance Fee**

Thu phí thông qua `Accountant` trong hàm `ExecuteProcessReport`

Khi một strategy được báo cáo, `Accountant` sẽ tính `performanceFee` và `refund`

- `PerformanceFee`: Fee thu dựa trên lợi nhuận (yêu cầu business 10%), fee này sẽ được chuyển đổi thành lượng liquidity và mint chúng dưới dạng thanh khoản cho `Accountant`

- `refund`: (Forked yearn v3) giá trị trả lại mỗi khi 1 strategy được báo cáo (có thể sử dụng để làm reward boost apy hoặc bù lỗ)

### Limit Mechanism

Vault có các cơ chế giới hạn số dư của người dùng bằng cách đặt các giới hạn tại hàm `deposit` và `withdraw` thông qua 2 cơ chế chính là `depositLimit` của Vault hoặc nâng cao hơn `depositLimitModule` và `withdrawLimitModule`

- `DepositLimit`: Giới hạn tvl của Vault, cập nhật thông qua hàm `setLimitDeposit`
- `depositLimitModule`: Contract kiểm tra nâng cao với input thêm địa chỉ user, có thể dùng đề giới hạn tài sản của riêng từng user
- `withdrawLimitModule`: Tương tự với depositLimitModue, thêm điều kiện kiểm tra nâng cao khi withdraw

### Unrealised Losses Mechanism

UnrealisedLosses là cơ chế tính tổn thất tạm thời (lỗ chưa được báo cáo), là phần quan trọng để bảo vệ người rút tiền sau không phải "ôm lỗ" cho người rút trước.

### Buy Debt Mechanism

Buy Debt là cơ chế cho phép những người có thẩm quyền có thể mua lại nợ của Vault

- Chỉ những người có ROLE `ROLE_DEBT_PURCHASER` có thể mua nợ
- ROLE được cấp bởi GORVERNANCE

### Minimum Total Idle

Minimum total Idle là chức năng giữ 1 lượng tiền tối thiểu trong vault để làm thanh khoản, chúng có chức năng

- Thanh khoản rút tiền nhành
- Tránh force-withdraw từ strategy gây tổn thất
- Được đặt và cập nhật bởi `ROLE_MINIMUM_IDLE_MANAGER`

# Function

### Deposit

#### Yêu cầu chức năng

- Người dùng gửi tài sản và nhận lạ lp tương ứng
- Nếu cơ chế tự động phân bổ vào strategy đầu tiên được bật thì tài sản sẽ tự động phân bổ vào strategy đầu tiên

#### Luồng hoạt động

Đầu tiên, kiểm tra 1 số điều kiện và sau đó lấy tài sản từ người gọi, và mint trả lại lp tương ứng

```solidity
require(assets <= vault.maxDeposit(receiver), "Exceed deposit limit");
require(shares > 0, "Cannot mint zero");
IERC20(vault.asset()).safeTransferFrom(
        caller,
        vault.addressVault,
        assets
    );
    vault.totalIdle += assets;
    vault._mint(receiver, shares);
```

Sau đó, nếu cơ chế tự động phân bổ được bật, tài sản sẽ được chuyển đến strategy đầu tiên thông qua việc cập nhật nợ cho stragety đầu tiên

```solidity
if (vault.autoAllocate && vault.defaultQueue.length > 0) {
        vault.ExecuteUpdateDebt(
            vault.defaultQueue[0],
            type(uint256).max,
            0
        );
    }
```

### Withdraw

# Withdraw

### Yêu cầu chức năng

- Người dùng rút tài sản bằng cách burn lượng lp tương ứng
- Kho tiền ưu tiên lượng tài sản rảnh rỗi trong vault, nếu không đủ sẽ rút phần thiếu từ các strategy
- Khi rút tiền sớm từ strategy sẽ có khả năng lỗ ( do strategy có thể lỗ), vì thế người dùng có thể nhập 1 giá trị `loss` hoạt động tương tự như slippage có thể châp nhận số tiền lỗ trong khả năng cho phép
- Cho phép B rút tiền từ lp của A nếu đã được approve lượng lp

### Luồng hoạt động

Đầu tiên kiểm tra điều kiện input và kiểm tra xem có thoả mãn nếu có cài đặt withdrawLimitModule

```solidity
        require(receiver != address(0), "Zero address");
        require(shares > 0, "No shares to redeem");
        require(assets > 0, "No assets to redeem");
        require(maxLoss <= Constants.MAX_BPS, "Invalid max loss");
        require(vault.balanceOf(owner) >= shares, "Insufficient shares");

        if (sender != owner) {
            vault._spendAllowance(owner, sender, shares);
        }

        if (vault.withdrawLimitModule != address(0)) {
            require(
                assets <=
                    IWithdrawLimitModule(vault.withdrawLimitModule)
                        .availableWithdrawLimit(owner, maxLoss, _strategies),
                "Exceed withdraw limit"
            );
        }

```

Trong trường hợp số tiền `totalIdle` không đủ lượng rút, bắt đầu rút từ các strategy

```solidity
{
    if (requestedAssets > currentTotalIdle) {
        require(vault.strategies[strategy].activation != 0, "Inactive strategy");
        uint256 currentDebt = vault.strategies[strategy].currentDebt;
        assetsToWithdraw = Math.min(assetsNeeded, currentDebt);
        uint256 maxWithdraw = IStrategy(strategy).convertToAssets(
            IStrategy(strategy).maxRedeem(address(this))
        );

        uint256 unrealisedLossesShare = UnrealisedLossesLogic // tính toán lượng tổn thất tạm thời khi strategy lỗ
            ._assessShareOfUnrealisedLosses(
                strategy,
                currentDebt,
                assetsToWithdraw
            );
        if (unrealisedLossesShare > 0) {   // nếu có tổn thất tạm thời
            // nếu như số tiền maxWithdraw mà nhỏ hơn số tiền muốn rút
            if (
                maxWithdraw < assetsToWithdraw - unrealisedLossesShare
            ) {
                // Điều chỉnh lại phần tổn thất tạm thời theo tỷ lệ
                // Công thức: unrealisedLossesShare = (unrealisedLossesShare * maxWithdraw) / (assetsToWithdraw - unrealisedLossesShare)
                unrealisedLossesShare =
                    (unrealisedLossesShare * maxWithdraw) /
                    (assetsToWithdraw - unrealisedLossesShare);
                // cập nhật lại số tiền muốn rút = số tiền tối đa có thể rút (số rút thực tế + số lỗ)
                assetsToWithdraw = maxWithdraw + unrealisedLossesShare;
            }
            // cập nhật lại số tiền muốn rút
            assetsToWithdraw -= unrealisedLossesShare;
            // cập nhật lại tổng số tiền muốn rút
            requestedAssets -= unrealisedLossesShare;
            // cập nhật lại tổng số tiền muốn rút từ các stratery
            assetsNeeded -= unrealisedLossesShare;
            // cập nhật lại số nợ của strategy
            currentTotalDebt -= unrealisedLossesShare;

            // nếu không thể rút tiền từ strategy này thì cập nhật lại số nợ của strategy
            if (maxWithdraw == 0 && unrealisedLossesShare > 0) {
                vault.strategies[strategy].currentDebt =
                    currentDebt -
                    unrealisedLossesShare;
                emit IVault.DebtUpdated(
                    strategy,
                    currentDebt,
                    vault.strategies[strategy].currentDebt
                );
            }
        }

        // số tiền rút sẽ dựa trên số tiền muốn rút và số tiền tối đa có thể rút
        assetsToWithdraw = Math.min(assetsToWithdraw, maxWithdraw);

        if (assetsToWithdraw == 0) continue;
        // WITHDRAW FROM STRATEGY
        vault._withdrawFromStrategy(strategy, assetsToWithdraw);
        // kiểm tra số tiền thực tế
        uint256 postBalance = IERC20(_asset).balanceOf(address(this));
        uint256 withdrawn = postBalance - previousBalance;
        uint256 loss = 0;
        // trường hợp rút quá số tiền, cần cập nhật lại assetsToWithdraw
        if (withdrawn > assetsToWithdraw) {
            if (withdrawn > currentDebt) {
                assetsToWithdraw = currentDebt;
            } else {
                assetsToWithdraw += withdrawn - assetsToWithdraw;
            }
        } else if (withdrawn < assetsToWithdraw) { // trường hợp rút không đủ như dự tính
            loss = assetsToWithdraw - withdrawn;
        }
        // tăng totalIdle lên sau khi rút
        currentTotalIdle += (assetsToWithdraw - loss);
        // cập nhật lại tổng số tiền muốn rút
        requestedAssets -= loss;
        // cập nhật lại nợ sau khi rút tiền
        currentTotalDebt -= assetsToWithdraw;

        // cập nhật lại debt bởi vì tổn thất tạm thời được gây ra bởi hành động rút tiền
        uint256 newDebt = currentDebt -
            (assetsToWithdraw + unrealisedLossesShare);
        vault.strategies[strategy].currentDebt = newDebt;
        emit IVault.DebtUpdated(strategy, currentDebt, newDebt);
        if (requestedAssets <= currentTotalIdle) break;
        // Cập nhật lại các chỉ số cho strategy tiếp theo
        previousBalance = postBalance;
        assetsNeeded -= assetsToWithdraw;
    }

    // Sau khi rút hết các strategy, kiểm tra xem đã đủ so với yêu cầu rút chưa

    require(
        currentTotalIdle >= requestedAssets,
        "Insufficient assets to withdraw"
    );
    vault.totalDebt = currentTotalDebt;

    // trong trường hợp requestedAssets nhỏ hơn với yêu cầu ban đầu (do có loss) nên kiểm tra điều kiện slippage maxLoss
    if (assets > requestedAssets && maxLoss < Constants.MAX_BPS) {
        require(
            assets - requestedAssets <=
                (assets * maxLoss) / Constants.MAX_BPS,
            "Too much loss"
        );
    }

    vault._burn(owner, shares);
    vault.totalIdle = currentTotalIdle - requestedAssets;
    IERC20(_asset).safeTransfer(receiver, requestedAssets);

    emit IVault.Withdrawn(owner, shares, requestedAssets, 0);
    return requestedAssets;
}
```

### Report

Hàm này sẽ báo cáo các chiến lược lỗ hoặc lời theo cơ chế.

Tính toán lời, lỗ thông qua lịch sử và thực tế

```solidity
  if (totalAssets > currentDebt) {
      gain = totalAssets - currentDebt;
  } else {
      loss = currentDebt - totalAssets;
  }
```

Tính toán lượng totalSupply tiếp theo, sau đó mint burn tương ứng, trong trường hợp lãi, số lp sẽ được mint thêm tại địa chỉ vault, burn dần thông qua giảm totalSupply, nếu lỗ sẽ burn hết lượng lp đang khoá

```solidity
uint256 totalSupply = vault.totalSupply() + lockedShares;
uint256 endingSupply = totalSupply - lockedShares + sharesToLock - sharesToBurn;

if (endingSupply > totalSupply) {
      vault._mint(address(this), endingSupply - totalSupply);
  }
if (totalSupply > endingSupply) {
    uint256 toBurn = Math.min(totalSupply - endingSupply,totalLockedShares);
    vault._burn(address(this), toBurn);
}
```

Sau đó tính toán lại công thức vesting.
