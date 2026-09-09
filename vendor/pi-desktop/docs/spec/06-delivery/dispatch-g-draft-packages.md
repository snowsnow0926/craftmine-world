# Fixed packages in a Craftmine draft

A library installation may add immutable assets and extensions to the Rust
draft. Subsequent resource patches preserve those packages. Capability reads,
verification compilation and application preparation use the same resolved
package set. Existing world packages are merged by fixed identity; a different
version/source for an already loaded extension, a missing dependency or a
duplicate command rejects the draft. Verified application carries the checked
extension artifact into the next formal world.

E2E scenario: install a module depending on a previously absent extension, edit
another resource, compile and apply; the extension must remain available at
each stage. Attempt a conflicting version and observe refusal before mutation.
`tests/dispatch/g/packages.test.mjs` covers the adapter lifecycle. The integrated
Rust library and native runtime scenario provides the final product evidence.
