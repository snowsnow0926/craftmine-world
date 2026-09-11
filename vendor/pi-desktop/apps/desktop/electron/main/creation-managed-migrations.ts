/** Reviewed host-owned compatibility records. Never populated from project data. */
export type ManagedCreationMigration={id:string;files:readonly {source:string;resource:string;from:readonly (string|null)[];to:readonly string[]}[]};
// Exact released 32cd879d / 594f698b observer cohorts; no authored files.
export const SCENE_OBSERVER_UPGRADE:ManagedCreationMigration={
  "id": "static-arraymesh-observer-20260912-v3",
  "files": [
    {
      "source": "craftmine_shared/base_adapter.gd",
      "resource": "shared/adapters/creation-sandbox.gd",
      "from": [
        "723e8a5b4a87101c77f3510687c2000b768ba2f0e89ad2f3ec2a9bb864e69bbb",
        "605c65deacc71862dde99bfd36fb64bf64867c3a1d7fc5ac02ac90f41cb0b478"
      ],
      "to": [
        "723e8a5b4a87101c77f3510687c2000b768ba2f0e89ad2f3ec2a9bb864e69bbb",
        "605c65deacc71862dde99bfd36fb64bf64867c3a1d7fc5ac02ac90f41cb0b478"
      ]
    },
    {
      "source": "craftmine_shared/runtime_bridge.gd",
      "resource": "shared/runtime_bridge.gd",
      "from": [
        "418bbb6f2a87b3092fb542b35a8c2007fef4725f554216f01fa48414c40ef6d3",
        "0edeb656fa574f9c8f51098d2ce37c0eec411d8554b5921615c12696485a79d9"
      ],
      "to": [
        "418bbb6f2a87b3092fb542b35a8c2007fef4725f554216f01fa48414c40ef6d3",
        "0edeb656fa574f9c8f51098d2ce37c0eec411d8554b5921615c12696485a79d9"
      ]
    },
    {
      "source": "craftmine_shared/state_guard.gd",
      "resource": "shared/state_guard.gd",
      "from": [
        "a1e524c8b45743244651b17c33c8ab916fad0b9f5809f9cbc3dc519a10562f20",
        "9b3bb64b8515b0937e9e884999cfe10684d16d4a2b0af53140cc2a81dcc11293"
      ],
      "to": [
        "a1e524c8b45743244651b17c33c8ab916fad0b9f5809f9cbc3dc519a10562f20",
        "9b3bb64b8515b0937e9e884999cfe10684d16d4a2b0af53140cc2a81dcc11293"
      ]
    },
    {
      "source": "craftmine_shared/headless_play_action.gd",
      "resource": "shared/headless_play_action.gd",
      "from": [
        "cc8a124b91069f65518fc4f0df5644ddabb12d5a398bfe9d4c213d4927a89cc7",
        "7f2454d7c3a8c93a8baf265ad72929cf9dcfcd48cb54084d3968f0828363fdda"
      ],
      "to": [
        "cc8a124b91069f65518fc4f0df5644ddabb12d5a398bfe9d4c213d4927a89cc7",
        "7f2454d7c3a8c93a8baf265ad72929cf9dcfcd48cb54084d3968f0828363fdda"
      ]
    },
    {
      "source": "craftmine_shared/scene_mesh_picker.gd",
      "resource": "shared/scene_mesh_picker.gd",
      "from": [
        "d5b6f04b5fe0b4e6acbeb21012cdedb356178221b18347045ee52a7ad468c512",
        "ea7ad596258005bb148ba00053746dc3c7a0ed12e420ddb37ec6ba2e01835e3e"
      ],
      "to": [
        "5def3e471cff15631dab28a328f108f8902b32727cfb1b54fd56add72472fe8e",
        "3c0440bf240da71cd33825d4a7e282f7b0ef47e25c6edea09c32ef57a9da56c8"
      ]
    }
  ]
};

// Reviewed 940/141 observers -> 314c27d5 integration: existing authored APIs and
// progress contracts stay unchanged. New fixed helpers require expected absence.
export const CREATION_MANAGED_MIGRATIONS:readonly ManagedCreationMigration[]=[SCENE_OBSERVER_UPGRADE,
  {
    "id": "scene-selection-and-input-20260912-v3",
    "files": [
      {
        "source": "craftmine_shared/base_adapter.gd",
        "resource": "shared/adapters/creation-sandbox.gd",
        "from": [
          "edf0f6efe5ed9381f7fca2b7365cbba6062463a4ebb489191086e734af3765ee",
          "b381b17a4c26176fa257a843fcd5d11e48ce0ea16252961c7d8f619ba14962c5",
          "8b941793dd989decb5c4c7e8339e92d896db4783f414fbff47183852a485b95d",
          "7e32ebfed318b423ec01585154d4de55ef04bfe5c1097640f20a2d055fda01c0"
        ],
        "to": [
          "723e8a5b4a87101c77f3510687c2000b768ba2f0e89ad2f3ec2a9bb864e69bbb",
          "605c65deacc71862dde99bfd36fb64bf64867c3a1d7fc5ac02ac90f41cb0b478"
        ]
      },
      {
        "source": "craftmine_shared/runtime_bridge.gd",
        "resource": "shared/runtime_bridge.gd",
        "from": [
          "faf11c86dc06006a37c65855cd48659107fbe19cc439d771aab45dbf866417a2",
          "4424aa350e3c2bcd8783c73a1adcb2a455b9c1ca2c4b4200a886d4eaa6966ac1"
        ],
        "to": [
          "418bbb6f2a87b3092fb542b35a8c2007fef4725f554216f01fa48414c40ef6d3",
          "0edeb656fa574f9c8f51098d2ce37c0eec411d8554b5921615c12696485a79d9"
        ]
      },
      {
        "source": "craftmine_shared/headless_play_action.gd",
        "resource": "shared/headless_play_action.gd",
        "from": [
          null
        ],
        "to": [
          "cc8a124b91069f65518fc4f0df5644ddabb12d5a398bfe9d4c213d4927a89cc7",
          "7f2454d7c3a8c93a8baf265ad72929cf9dcfcd48cb54084d3968f0828363fdda"
        ]
      },
      {
        "source": "craftmine_shared/scene_mesh_picker.gd",
        "resource": "shared/scene_mesh_picker.gd",
        "from": [
          null
        ],
        "to": [
          "5def3e471cff15631dab28a328f108f8902b32727cfb1b54fd56add72472fe8e",
          "3c0440bf240da71cd33825d4a7e282f7b0ef47e25c6edea09c32ef57a9da56c8"
        ]
      }
    ]
  }
];
