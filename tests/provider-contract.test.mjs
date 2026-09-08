import test from 'node:test';
import assert from 'node:assert/strict';
import { PROVIDER_CAPABILITIES, assertCapability, capabilityStatus, providerContract, providerContractText } from '../app/harness/provider-contract.mjs';

test('后端能力声明：实测过的是 measured，没证据的一律 unavailable', () => {
  const contract = providerContract('deepseek', { model: 'deepseek-v4.1-flash-expires-on-0910' });
  assert.equal(contract.format, 'craftmine.provider-contract/1');
  assert.equal(contract.registered, true);
  assert.equal(contract.capabilities.toolCalls.value, 'yes');
  assert.equal(contract.capabilities.toolCalls.source, 'measured');
  assert.equal(contract.capabilities.structuredOutput.value, 'partial', '严格 JSON Schema 不可用，只能算部分支持');
  assert.equal(contract.capabilities.imageInput.value, 'unavailable');
  assert.equal(contract.capabilities.nativeCompaction.value, 'unavailable');
  assert.equal(contract.capabilities.contextWindow.source, 'user');
  assert.equal(contract.capabilities.usageReport.value, 'yes');
  for (const name of PROVIDER_CAPABILITIES) assert.ok(contract.capabilities[name], name);
  assert.match(providerContractText(contract), /structuredOutput: partial/);
  assert.match(providerContractText(contract), /来源 measured/);
});

test('未登记的后端不能推定它支持任何能力', () => {
  const contract = providerContract('some-new-thing');
  assert.equal(contract.registered, false);
  for (const name of PROVIDER_CAPABILITIES) {
    assert.equal(contract.capabilities[name].value, 'unavailable', name);
    assert.equal(contract.capabilities[name].source, 'unknown', name);
  }
  assert.match(contract.capabilities.toolCalls.note, /不能推定/);
});

test('依赖某项能力前必须显式检查，不支持就报明确原因', () => {
  const contract = providerContract('deepseek');
  assert.equal(capabilityStatus(contract, 'toolCalls'), 'yes');
  assert.throws(() => capabilityStatus(contract, '不存在的项'), /没有这个能力项/);
  assert.equal(assertCapability(contract, 'structuredOutput'), 'partial', 'partial 可以用，但调用方要知道它不是严格模式');
  assert.throws(() => assertCapability(contract, 'imageInput'), /不支持 imageInput/);
  assert.throws(() => assertCapability(providerContract('未知后端'), 'toolCalls'), /不支持 toolCalls/);
});
