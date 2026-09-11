/** Reviewed host-owned compatibility records. Never populated from project data. */
export type ManagedCreationMigration={id:string;files:readonly {source:string;resource:string;from:readonly (string|null)[];to:readonly string[]}[]};
// 940c5a84 -> 141642e9 changes only the fixed observer: existing mutable world
// methods and progress contracts are unchanged. Both exact newline encodings.
export const CREATION_MANAGED_MIGRATIONS:readonly ManagedCreationMigration[]=[{
 id:'scene-object-observer-20260912-v1',files:[{
  source:'craftmine_shared/base_adapter.gd',resource:'shared/adapters/creation-sandbox.gd',
  from:['edf0f6efe5ed9381f7fca2b7365cbba6062463a4ebb489191086e734af3765ee','b381b17a4c26176fa257a843fcd5d11e48ce0ea16252961c7d8f619ba14962c5'],
  to:['8b941793dd989decb5c4c7e8339e92d896db4783f414fbff47183852a485b95d','7e32ebfed318b423ec01585154d4de55ef04bfe5c1097640f20a2d055fda01c0'],
 }],
}];
