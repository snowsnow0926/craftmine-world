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
