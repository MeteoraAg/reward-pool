/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/farming.json`.
 */
export type Farming = {
  "address": "FarmuwXPWXvefWUeqFAa5w6rifLkq5X6E8bimYvrhCB1",
  "metadata": {
    "name": "farming",
    "version": "0.2.2",
    "spec": "0.1.0",
    "description": "Created with Anchor"
  },
  "docs": [
    "Dual farming program"
  ],
  "instructions": [
    {
      "name": "authorizeFunder",
      "docs": [
        "Authorize additional funders for the pool"
      ],
      "discriminator": [
        18,
        74,
        66,
        11,
        50,
        8,
        89,
        213
      ],
      "accounts": [
        {
          "name": "pool",
          "docs": [
            "Global accounts for the staking instance."
          ],
          "writable": true
        },
        {
          "name": "authority",
          "docs": [
            "Authority of the pool"
          ],
          "signer": true,
          "relations": [
            "pool"
          ]
        }
      ],
      "args": [
        {
          "name": "funderToAdd",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "claim",
      "docs": [
        "User claim rewards"
      ],
      "discriminator": [
        62,
        198,
        214,
        193,
        213,
        159,
        108,
        210
      ],
      "accounts": [
        {
          "name": "pool",
          "docs": [
            "Global accounts for the staking instance."
          ],
          "writable": true,
          "relations": [
            "user"
          ]
        },
        {
          "name": "stakingVault",
          "docs": [
            "Staking vault PDA."
          ],
          "writable": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "rewardAVault",
          "docs": [
            "Reward A Vault PDA"
          ],
          "writable": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "rewardBVault",
          "docs": [
            "Reward B Vault PDA"
          ],
          "writable": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "user",
          "docs": [
            "User."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "owner",
          "docs": [
            "Authority of user"
          ],
          "signer": true,
          "relations": [
            "user"
          ]
        },
        {
          "name": "rewardAAccount",
          "docs": [
            "User's Reward A ATA"
          ],
          "writable": true
        },
        {
          "name": "rewardBAccount",
          "docs": [
            "User's Reward B ATA"
          ],
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "closePool",
      "docs": [
        "Closes a pool account. Only able to be done when there are no users staked."
      ],
      "discriminator": [
        140,
        189,
        209,
        23,
        239,
        62,
        239,
        11
      ],
      "accounts": [
        {
          "name": "refundee",
          "writable": true
        },
        {
          "name": "stakingRefundee",
          "writable": true
        },
        {
          "name": "rewardARefundee",
          "writable": true
        },
        {
          "name": "rewardBRefundee",
          "writable": true
        },
        {
          "name": "pool",
          "writable": true
        },
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "stakingVault",
          "writable": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "rewardAVault",
          "writable": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "rewardBVault",
          "writable": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "closeUser",
      "docs": [
        "Closes a users stake account. Validation is done to ensure this is only allowed when the user has nothing staked and no rewards pending."
      ],
      "discriminator": [
        86,
        219,
        138,
        140,
        236,
        24,
        118,
        200
      ],
      "accounts": [
        {
          "name": "pool",
          "writable": true,
          "relations": [
            "user"
          ]
        },
        {
          "name": "user",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "owner",
          "writable": true,
          "signer": true,
          "relations": [
            "user"
          ]
        }
      ],
      "args": []
    },
    {
      "name": "createUser",
      "docs": [
        "Initialize a user staking account"
      ],
      "discriminator": [
        108,
        227,
        130,
        130,
        252,
        109,
        75,
        218
      ],
      "accounts": [
        {
          "name": "pool",
          "docs": [
            "Global accounts for the staking instance."
          ],
          "writable": true
        },
        {
          "name": "user",
          "docs": [
            "user"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "owner",
          "docs": [
            "Authority of user account"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "docs": [
            "Misc."
          ],
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "deauthorizeFunder",
      "docs": [
        "Deauthorize funders for the pool"
      ],
      "discriminator": [
        75,
        130,
        38,
        206,
        85,
        75,
        82,
        37
      ],
      "accounts": [
        {
          "name": "pool",
          "docs": [
            "Global accounts for the staking instance."
          ],
          "writable": true
        },
        {
          "name": "authority",
          "docs": [
            "Authority of the pool"
          ],
          "signer": true,
          "relations": [
            "pool"
          ]
        }
      ],
      "args": [
        {
          "name": "funderToRemove",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "deposit",
      "docs": [
        "User deposit tokens in the pool."
      ],
      "discriminator": [
        242,
        35,
        198,
        137,
        82,
        225,
        242,
        182
      ],
      "accounts": [
        {
          "name": "pool",
          "docs": [
            "Global accounts for the deposit/withdraw instance."
          ],
          "writable": true,
          "relations": [
            "user"
          ]
        },
        {
          "name": "stakingVault",
          "docs": [
            "Staking vault PDA."
          ],
          "writable": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "user",
          "docs": [
            "User."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "owner",
          "docs": [
            "Authority of user"
          ],
          "signer": true,
          "relations": [
            "user"
          ]
        },
        {
          "name": "stakeFromAccount",
          "docs": [
            "User staking ATA"
          ],
          "writable": true
        },
        {
          "name": "tokenProgram",
          "docs": [
            "Misc."
          ],
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "fund",
      "docs": [
        "Fund the pool with rewards.  This resets the clock on the end date, pushing it out to the set duration. And, linearly redistributes remaining rewards."
      ],
      "discriminator": [
        218,
        188,
        111,
        221,
        152,
        113,
        174,
        7
      ],
      "accounts": [
        {
          "name": "pool",
          "docs": [
            "Global accounts for the staking instance."
          ],
          "writable": true
        },
        {
          "name": "stakingVault",
          "docs": [
            "Staking vault PDA"
          ],
          "writable": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "rewardAVault",
          "docs": [
            "Reward A Vault PDA"
          ],
          "writable": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "rewardBVault",
          "docs": [
            "Reward B Vault PDA"
          ],
          "writable": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "funder",
          "docs": [
            "Funder"
          ],
          "signer": true
        },
        {
          "name": "fromA",
          "docs": [
            "Funder reward A ATA"
          ],
          "writable": true
        },
        {
          "name": "fromB",
          "docs": [
            "Funder reward B ATA"
          ],
          "writable": true
        },
        {
          "name": "tokenProgram",
          "docs": [
            "Misc."
          ],
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amountA",
          "type": "u64"
        },
        {
          "name": "amountB",
          "type": "u64"
        }
      ]
    },
    {
      "name": "initializePool",
      "docs": [
        "Initializes a new pool. Able to create pool with single reward by passing the same Mint account for reward_a_mint and reward_a_mint"
      ],
      "discriminator": [
        95,
        180,
        10,
        172,
        84,
        174,
        232,
        40
      ],
      "accounts": [
        {
          "name": "pool",
          "docs": [
            "Global accounts for the staking instance."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "arg",
                "path": "rewardDuration"
              },
              {
                "kind": "account",
                "path": "stakingMint"
              },
              {
                "kind": "account",
                "path": "rewardAMint"
              },
              {
                "kind": "account",
                "path": "rewardBMint"
              },
              {
                "kind": "account",
                "path": "base"
              }
            ]
          }
        },
        {
          "name": "stakingMint",
          "docs": [
            "Staking mint"
          ]
        },
        {
          "name": "stakingVault",
          "docs": [
            "Staking vault PDA"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  107,
                  105,
                  110,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "rewardAMint",
          "docs": [
            "Reward A mint"
          ]
        },
        {
          "name": "rewardAVault",
          "docs": [
            "Reward A vault PDA"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  119,
                  97,
                  114,
                  100,
                  95,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "rewardBMint",
          "docs": [
            "Reward B mint"
          ]
        },
        {
          "name": "rewardBVault",
          "docs": [
            "Reward B vault PDA"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  119,
                  97,
                  114,
                  100,
                  95,
                  98
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "authority",
          "docs": [
            "Authority of the pool"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "base",
          "docs": [
            "Base"
          ],
          "signer": true
        },
        {
          "name": "systemProgram",
          "docs": [
            "System program"
          ],
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "tokenProgram",
          "docs": [
            "SPL Token program"
          ],
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "rent",
          "docs": [
            "Rent"
          ],
          "address": "SysvarRent111111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "rewardDuration",
          "type": "u64"
        }
      ]
    },
    {
      "name": "migrateFarmingRate",
      "docs": [
        "anyone can call this"
      ],
      "discriminator": [
        90,
        100,
        86,
        59,
        115,
        104,
        184,
        92
      ],
      "accounts": [
        {
          "name": "pool",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "pause",
      "docs": [
        "Pause the pool"
      ],
      "discriminator": [
        211,
        22,
        221,
        251,
        74,
        121,
        193,
        47
      ],
      "accounts": [
        {
          "name": "pool",
          "docs": [
            "Global accounts for the staking instance."
          ],
          "writable": true
        },
        {
          "name": "authority",
          "docs": [
            "Authority of the pool"
          ],
          "signer": true,
          "relations": [
            "pool"
          ]
        }
      ],
      "args": []
    },
    {
      "name": "unpause",
      "docs": [
        "Unpauses a previously paused pool. Allowing for funding."
      ],
      "discriminator": [
        169,
        144,
        4,
        38,
        10,
        141,
        188,
        255
      ],
      "accounts": [
        {
          "name": "pool",
          "docs": [
            "Global accounts for the staking instance."
          ],
          "writable": true
        },
        {
          "name": "authority",
          "docs": [
            "Authority of the pool"
          ],
          "signer": true,
          "relations": [
            "pool"
          ]
        }
      ],
      "args": []
    },
    {
      "name": "withdraw",
      "docs": [
        "User withdraw tokens in the pool."
      ],
      "discriminator": [
        183,
        18,
        70,
        156,
        148,
        109,
        161,
        34
      ],
      "accounts": [
        {
          "name": "pool",
          "docs": [
            "Global accounts for the deposit/withdraw instance."
          ],
          "writable": true,
          "relations": [
            "user"
          ]
        },
        {
          "name": "stakingVault",
          "docs": [
            "Staking vault PDA."
          ],
          "writable": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "user",
          "docs": [
            "User."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "owner",
          "docs": [
            "Authority of user"
          ],
          "signer": true,
          "relations": [
            "user"
          ]
        },
        {
          "name": "stakeFromAccount",
          "docs": [
            "User staking ATA"
          ],
          "writable": true
        },
        {
          "name": "tokenProgram",
          "docs": [
            "Misc."
          ],
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "sptAmount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "withdrawExtraToken",
      "docs": [
        "Withdraw token that mistakenly deposited to staking_vault"
      ],
      "discriminator": [
        5,
        188,
        29,
        19,
        10,
        160,
        82,
        227
      ],
      "accounts": [
        {
          "name": "pool",
          "docs": [
            "Global accounts for the staking instance."
          ]
        },
        {
          "name": "stakingVault",
          "docs": [
            "Staking vault PDA"
          ],
          "writable": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "withdrawToAccount",
          "docs": [
            "Token account to receive mistakenly deposited token"
          ],
          "writable": true
        },
        {
          "name": "authority",
          "docs": [
            "Authority of the staking instance"
          ],
          "signer": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "tokenProgram",
          "docs": [
            "Misc."
          ],
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    }
  ],
  "accounts": [
    {
      "name": "pool",
      "discriminator": [
        241,
        154,
        109,
        4,
        17,
        177,
        109,
        188
      ]
    },
    {
      "name": "user",
      "discriminator": [
        159,
        117,
        95,
        227,
        239,
        151,
        58,
        236
      ]
    }
  ],
  "events": [
    {
      "name": "eventAuthorizeFunder",
      "discriminator": [
        110,
        19,
        172,
        165,
        222,
        214,
        0,
        171
      ]
    },
    {
      "name": "eventClaim",
      "discriminator": [
        171,
        144,
        1,
        189,
        120,
        200,
        38,
        11
      ]
    },
    {
      "name": "eventDeposit",
      "discriminator": [
        36,
        210,
        117,
        168,
        181,
        241,
        236,
        248
      ]
    },
    {
      "name": "eventFund",
      "discriminator": [
        3,
        82,
        235,
        70,
        19,
        132,
        74,
        149
      ]
    },
    {
      "name": "eventUnauthorizeFunder",
      "discriminator": [
        50,
        63,
        139,
        226,
        196,
        102,
        109,
        229
      ]
    },
    {
      "name": "eventWithdraw",
      "discriminator": [
        216,
        247,
        255,
        93,
        80,
        238,
        33,
        136
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "insufficientFundWithdraw",
      "msg": "Insufficient funds to withdraw."
    },
    {
      "code": 6001,
      "name": "amountMustBeGreaterThanZero",
      "msg": "Amount must be greater than zero."
    },
    {
      "code": 6002,
      "name": "singleDepositTokenBCannotBeFunded",
      "msg": "Reward B cannot be funded - pool is single deposit."
    },
    {
      "code": 6003,
      "name": "poolPaused",
      "msg": "Pool is paused."
    },
    {
      "code": 6004,
      "name": "durationTooShort",
      "msg": "Duration cannot be shorter than one day."
    },
    {
      "code": 6005,
      "name": "funderAlreadyAuthorized",
      "msg": "Provided funder is already authorized to fund."
    },
    {
      "code": 6006,
      "name": "maxFunders",
      "msg": "Maximum funders already authorized."
    },
    {
      "code": 6007,
      "name": "cannotDeauthorizePoolAuthority",
      "msg": "Cannot deauthorize the primary pool authority."
    },
    {
      "code": 6008,
      "name": "cannotDeauthorizeMissingAuthority",
      "msg": "Authority not found for deauthorization."
    },
    {
      "code": 6009,
      "name": "mathOverflow",
      "msg": "Math operation overflow"
    }
  ],
  "types": [
    {
      "name": "eventAuthorizeFunder",
      "docs": [
        "Authorized funder event"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "newFunder",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "eventClaim",
      "docs": [
        "Claim event"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "amountA",
            "type": "u64"
          },
          {
            "name": "amountB",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "eventDeposit",
      "docs": [
        "Deposit event"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "eventFund",
      "docs": [
        "Fund event"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "amountA",
            "type": "u64"
          },
          {
            "name": "amountB",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "eventUnauthorizeFunder",
      "docs": [
        "Un-authorized funder event"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "funder",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "eventWithdraw",
      "docs": [
        "Withdraw event"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "pool",
      "docs": [
        "Pool account wrapper"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "docs": [
              "Privileged account."
            ],
            "type": "pubkey"
          },
          {
            "name": "paused",
            "docs": [
              "Paused state of the program"
            ],
            "type": "bool"
          },
          {
            "name": "stakingMint",
            "docs": [
              "Mint of the token that can be staked."
            ],
            "type": "pubkey"
          },
          {
            "name": "stakingVault",
            "docs": [
              "Vault to store staked tokens."
            ],
            "type": "pubkey"
          },
          {
            "name": "rewardAMint",
            "docs": [
              "Mint of the reward A token."
            ],
            "type": "pubkey"
          },
          {
            "name": "rewardAVault",
            "docs": [
              "Vault to store reward A tokens."
            ],
            "type": "pubkey"
          },
          {
            "name": "rewardBMint",
            "docs": [
              "Mint of the reward B token."
            ],
            "type": "pubkey"
          },
          {
            "name": "rewardBVault",
            "docs": [
              "Vault to store reward B tokens."
            ],
            "type": "pubkey"
          },
          {
            "name": "baseKey",
            "docs": [
              "Base key"
            ],
            "type": "pubkey"
          },
          {
            "name": "rewardDuration",
            "docs": [
              "The period which rewards are linearly distributed."
            ],
            "type": "u64"
          },
          {
            "name": "rewardDurationEnd",
            "docs": [
              "The timestamp at which the current reward period ends."
            ],
            "type": "u64"
          },
          {
            "name": "lastUpdateTime",
            "docs": [
              "The last time reward states were updated."
            ],
            "type": "u64"
          },
          {
            "name": "rewardARate",
            "docs": [
              "deprecated field"
            ],
            "type": "u64"
          },
          {
            "name": "rewardBRate",
            "docs": [
              "deprecated field"
            ],
            "type": "u64"
          },
          {
            "name": "rewardAPerTokenStored",
            "docs": [
              "Last calculated reward A per pool token."
            ],
            "type": "u128"
          },
          {
            "name": "rewardBPerTokenStored",
            "docs": [
              "Last calculated reward B per pool token."
            ],
            "type": "u128"
          },
          {
            "name": "userStakeCount",
            "docs": [
              "Users staked"
            ],
            "type": "u32"
          },
          {
            "name": "funders",
            "docs": [
              "authorized funders",
              "[] because short size, fixed account size, and ease of use on",
              "client due to auto generated account size property"
            ],
            "type": {
              "array": [
                "pubkey",
                3
              ]
            }
          },
          {
            "name": "rewardARateU128",
            "docs": [
              "reward_a_rate in u128 form"
            ],
            "type": "u128"
          },
          {
            "name": "rewardBRateU128",
            "docs": [
              "reward_b_rate in u128 form"
            ],
            "type": "u128"
          },
          {
            "name": "poolBump",
            "docs": [
              "Pool bump"
            ],
            "type": "u8"
          },
          {
            "name": "totalStaked",
            "docs": [
              "Total staked amount"
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "user",
      "docs": [
        "Farming user account"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "docs": [
              "Pool the this user belongs to."
            ],
            "type": "pubkey"
          },
          {
            "name": "owner",
            "docs": [
              "The owner of this account."
            ],
            "type": "pubkey"
          },
          {
            "name": "rewardAPerTokenComplete",
            "docs": [
              "The amount of token A claimed."
            ],
            "type": "u128"
          },
          {
            "name": "rewardBPerTokenComplete",
            "docs": [
              "The amount of token B claimed."
            ],
            "type": "u128"
          },
          {
            "name": "rewardAPerTokenPending",
            "docs": [
              "The amount of token A pending claim."
            ],
            "type": "u64"
          },
          {
            "name": "rewardBPerTokenPending",
            "docs": [
              "The amount of token B pending claim."
            ],
            "type": "u64"
          },
          {
            "name": "balanceStaked",
            "docs": [
              "The amount staked."
            ],
            "type": "u64"
          },
          {
            "name": "nonce",
            "docs": [
              "Signer nonce."
            ],
            "type": "u8"
          }
        ]
      }
    }
  ]
};
