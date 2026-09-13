import type {ManagedCreationMigration} from './creation-managed-migrations';

// Exact released conservative picker to the reviewed ray-local budget fix.
export const MESH_PICKER_UPGRADE:ManagedCreationMigration={
  "id": "ray-local-mesh-budget-20260913",
  "files": [
    {
      "source": "craftmine_shared/scene_mesh_picker_v2.gd",
      "resource": "shared/scene_mesh_picker_v2.gd",
      "from": [
        "f83525ba2dea31a2578cdae07a91d379ad177011ef689b57dfd9937c135a3938",
        "6f7cab96da6294be50b79295b9d9a9a0fc098f0c0fa1e8286f78767b22a9ac9c"
      ],
      "to": [
        "09b64ed260b83dd9b3c0559868d6ee3c34ece69876266154b3821ce166865acd",
        "171300925105f2fcabe88fd65a20ec21d19cdfade9837e9baf66c5e80e66f752"
      ]
    }
  ]
};
