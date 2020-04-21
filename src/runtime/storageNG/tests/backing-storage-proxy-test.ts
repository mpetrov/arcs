/**
 * @license
 * Copyright (c) 2020 Google Inc. All rights reserved.
 * This code may only be used under the BSD style license found at
 * http://polymer.github.io/LICENSE.txt
 * Code distributed by Google as part of this project is also
 * subject to an additional IP rights grant found at
 * http://polymer.github.io/PATENTS.txt
 */

import {MockBackingStore, MockHandle} from '../testing/test-storage.js';
import {CRDTEntityTypeRecord, Identified, CRDTEntity, EntityOpTypes, EntityOperation} from '../../crdt/crdt-entity.js';
import {BackingStore} from '../backing-store.js';
import {BackingStorageProxy} from '../backing-storage-proxy.js';
import {BackingType, EntityType} from '../../type.js';
import {assert} from '../../../platform/chai-web.js';
import {ProxyMessageType} from '../store.js';
import {CRDTSingleton} from '../../crdt/crdt-singleton.js';

function getBackingStorageProxy(store: BackingStore<CRDTEntityTypeRecord<Identified, Identified>>, entityType: EntityType): BackingStorageProxy<CRDTEntityTypeRecord<Identified, Identified>> {
  return new BackingStorageProxy(store, new BackingType(entityType), store.storageKey.toString());
}

describe('BackingStorageProxy', async () => {
  const fooEntityType = EntityType.make(['Foo'], {value: 'Text'});

  const fooEntityCRDT = new CRDTEntity({value: new CRDTSingleton<{id: string, value: string}>()}, {});
  fooEntityCRDT.applyOperation({type: EntityOpTypes.Set, field: 'value', value: {id: 'Text', value: 'Text'}, actor: 'me', clock: {'me': 1}});

  const foo2EntityCRDT = new CRDTEntity({value: new CRDTSingleton<{id: string, value: string}>()}, {});
  foo2EntityCRDT.applyOperation({type: EntityOpTypes.Set, field: 'value', value: {id: 'AlsoText', value: 'AlsoText'}, actor: 'me', clock: {'me': 1}});

  it('creation of storage proxies', async () => {
    const mockBackingStore = new MockBackingStore<CRDTEntityTypeRecord<Identified, Identified>>();
    const backingStorageProxy = getBackingStorageProxy(mockBackingStore, fooEntityType);

    const mockHandle = new MockHandle(backingStorageProxy.getStorageProxy('foo-id'));
    const mockHandle2 = new MockHandle(backingStorageProxy.getStorageProxy('foo-id'));
    assert.strictEqual(mockHandle.storageProxy, mockHandle2.storageProxy);

    // a different muxId will create a different storage proxy
    const mockHandle3 = new MockHandle(backingStorageProxy.getStorageProxy('foo-id-2'));
    assert.notStrictEqual(mockHandle.storageProxy, mockHandle3.storageProxy);
  });
  it('can direct ProxyMessages from storage proxy to backing stores', async () => {
    const mockBackingStore = new MockBackingStore<CRDTEntityTypeRecord<Identified, Identified>>();
    const backingStorageProxy = getBackingStorageProxy(mockBackingStore, fooEntityType);
    const storageProxy = backingStorageProxy.getStorageProxy('foo-id');

    // Ensure backing store receives SyncRequest proxy messages
    // (registering a handle to the storage proxy will trigger a sync request)
    const mockHandle = new MockHandle<CRDTEntityTypeRecord<Identified, Identified>>(storageProxy);
    assert.deepEqual(mockBackingStore.lastCapturedMessage, {type: ProxyMessageType.SyncRequest, muxId: 'foo-id', id: 1});

    // Ensure backing store receives ModelUpdate proxy messages
    await storageProxy.onMessage({type: ProxyMessageType.ModelUpdate, model: fooEntityCRDT.getData(), id: 1, muxId: 'foo-id'});
    await storageProxy.onMessage({type: ProxyMessageType.SyncRequest, id: 1});
    assert.deepEqual(mockBackingStore.lastCapturedMessage, {type: ProxyMessageType.ModelUpdate, id: 1, model: fooEntityCRDT.getData(), muxId: 'foo-id'});

    // Ensure backing store receives Operations proxy messages
    const op: EntityOperation<Identified, Identified> = {
      type: EntityOpTypes.Set,
      field: 'value',
      value: {id: 'DifferentText'},
      actor: 'me',
      clock: {'me': 2}
    };
    const result = await storageProxy.applyOp(op);
    assert.isTrue(result);
    assert.deepEqual(mockBackingStore.lastCapturedMessage, {
      type: ProxyMessageType.Operations,
      operations: [op],
      id: 1,
      muxId: 'foo-id'
    });
  });
  it('propagates exceptions to the backing store', async () => {
    const mockBackingStore = new MockBackingStore<CRDTEntityTypeRecord<Identified, Identified>>();
    const backingStorageProxy = getBackingStorageProxy(mockBackingStore, fooEntityType);
    mockBackingStore.mockCRDTData['foo-id'] = fooEntityCRDT.getData();

    const mockHandle = new MockHandle(backingStorageProxy.getStorageProxy('foo-id'));
    assert.deepEqual(
      mockBackingStore.lastCapturedMessage,
      {type: ProxyMessageType.SyncRequest, id: 1, muxId: 'foo-id'}
    );
    mockHandle.onSync = () => {
      throw new Error('something wrong');
    };

    await mockHandle.storageProxy.getParticleView();
    await mockHandle.storageProxy.idle();
    assert.equal(
      mockBackingStore.lastCapturedException.message,
      'SystemException: exception Error raised when invoking system function StorageProxyScheduler::_dispatch on behalf of particle handle: something wrong');
  });
  it('can direct ModelUpdate ProxyMessages from the backing store to correct storage proxies', async () => {
    const mockBackingStore = new MockBackingStore<CRDTEntityTypeRecord<Identified, Identified>>();
    const backingStorageProxy = getBackingStorageProxy(mockBackingStore, fooEntityType);

    const fooStorageProxy = backingStorageProxy.getStorageProxy('foo-id');
    const foo2StorageProxy = backingStorageProxy.getStorageProxy('foo-id-2');
    const fooMockHandle1 = new MockHandle<CRDTEntityTypeRecord<Identified, Identified>>(fooStorageProxy);
    const fooMockHandle2 = new MockHandle<CRDTEntityTypeRecord<Identified, Identified>>(fooStorageProxy);
    const foo2MockHandle = new MockHandle<CRDTEntityTypeRecord<Identified, Identified>>(foo2StorageProxy);

    // act as though mockBackingStore calls the callback for backingStorageProxy to propagate a model update.
    await backingStorageProxy.onMessage({type: ProxyMessageType.ModelUpdate, model: fooEntityCRDT.getData(), muxId: 'foo-id'});
    await fooStorageProxy.idle();

    assert.deepEqual(await fooStorageProxy.getParticleView(), fooEntityCRDT.getParticleView());
    assert.isTrue(fooMockHandle1.onSyncCalled);
    assert.isTrue(fooMockHandle2.onSyncCalled);
    assert.isFalse(foo2MockHandle.onSyncCalled);

    await mockBackingStore.onProxyMessage({type: ProxyMessageType.ModelUpdate, model: foo2EntityCRDT.getData(), muxId: 'foo-id-2'});
    await backingStorageProxy.onMessage({type: ProxyMessageType.ModelUpdate, model: foo2EntityCRDT.getData(), muxId: 'foo-id-2'});
    await foo2StorageProxy.idle();

    assert.deepEqual(await foo2StorageProxy.getParticleView(), foo2EntityCRDT.getParticleView());
    assert.isTrue(foo2MockHandle.onSyncCalled);
  });
  it('can direct Operations ProxyMessages from the backing store to correct storage proxies', async () => {
    const mockBackingStore = new MockBackingStore<CRDTEntityTypeRecord<Identified, Identified>>();
    const backingStorageProxy = getBackingStorageProxy(mockBackingStore, fooEntityType);
    const fooStorageProxy = backingStorageProxy.getStorageProxy('foo-id');
    const foo2StorageProxy = backingStorageProxy.getStorageProxy('foo-id-2');

    const fooMockHandle1 = new MockHandle(fooStorageProxy);
    const fooMockHandle2 = new MockHandle(fooStorageProxy);
    const foo2MockHandle = new MockHandle(foo2StorageProxy);

    const op: EntityOperation<Identified, Identified> = {
      type: EntityOpTypes.Set,
      field: 'value',
      value: {id: 'DifferentText'},
      actor: 'me',
      clock: {'me': 1}
    };

    await backingStorageProxy.onMessage({type: ProxyMessageType.Operations, operations: [op], id: 1, muxId: 'foo-id'});
    await fooStorageProxy.idle();

    assert.deepEqual(fooMockHandle1.lastUpdate, op);
    assert.deepEqual(fooMockHandle2.lastUpdate, op);
    assert.isNull(foo2MockHandle.lastUpdate);
  });
});