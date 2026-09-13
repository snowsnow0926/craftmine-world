import type {ManagedCreationMigration} from './creation-managed-migrations';
// Exact released engine bridge; no authored source or progress rewrite.
export const CREATION_PREVIEW_UPGRADE:ManagedCreationMigration={
  "id": "stock-placement-preview-20260914",
  "files": [
    {
      "source": "craftmine_shared/runtime_bridge.gd",
      "resource": "shared/runtime_bridge_engine_v1.gd",
      "from": [
        "593ade6619c31f44ab3c86790a79ea8ebc0fbd0ac6b9a5ffee212ad5f8849270",
        "04ce85779b9784d5008968b886d4ed8d4e6be3e082e8730f6ee5c8a64614c67b"
      ],
      "to": [
        "938c42a578bb37c0590198232448b1391f688b95f15ce7d5fce65d802cca7e08",
        "aaf17d885bfd63125ae850b5d80c40461157c7d7fe074d0433f8653c484d686c"
      ]
    }
  ]
};

// Complete ordinary bridge cohort opts into the fixed visual extension.
export const CREATION_PREVIEW_BOOTSTRAP:ManagedCreationMigration={
  "id": "stock-placement-preview-bootstrap-20260914",
  "files": [
    {
      "source": "craftmine_shared/runtime_bridge.gd",
      "resource": "shared/runtime_bridge_engine_v1.gd",
      "from": [
        "58b4f108bc8fe6fa9232c9f98e577bc6a2914d1f623f373f79cec5450cba51f3",
        "ad6e71816e7db7e33411e95f04c15c20d13894a50403974537d5eb2f29b37c27"
      ],
      "to": [
        "938c42a578bb37c0590198232448b1391f688b95f15ce7d5fce65d802cca7e08",
        "aaf17d885bfd63125ae850b5d80c40461157c7d7fe074d0433f8653c484d686c"
      ]
    },
    {
      "source": "craftmine_shared/runtime_bridge_base.gd",
      "resource": "shared/runtime_bridge.gd",
      "from": [
        null
      ],
      "to": [
        "58b4f108bc8fe6fa9232c9f98e577bc6a2914d1f623f373f79cec5450cba51f3",
        "ad6e71816e7db7e33411e95f04c15c20d13894a50403974537d5eb2f29b37c27"
      ]
    },
    {
      "source": "craftmine_shared/engine_performance.gd",
      "resource": "shared/engine_performance.gd",
      "from": [
        null
      ],
      "to": [
        "1a2fdaabfa81b1217e74656bc9d720a2d9e34f5fe7652e16626ed9dcbfb61945",
        "d96f57dab89f75608cd7ece76b87e71f287c93bc209710b2176fb68797a9d8e7"
      ]
    }
  ]
};
export const CREATION_PREVIEW_MIGRATIONS=[CREATION_PREVIEW_UPGRADE,CREATION_PREVIEW_BOOTSTRAP] as const;
