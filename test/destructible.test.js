describe('destructible', () => {
    const assert = require('assert')
    const Destructible = require('..')
    const Future = require('prospective/future')
    it('can be constructed', async () => {
        const destructible = new Destructible('main')
        destructible.destroy()
        assert.deepStrictEqual(await destructible.promise, {}, 'nothing')
    })
    it('can wait for a durable promise', async () => {
        const destructible = new Destructible('main')
        destructible.durable('immediate', new Promise(resolve => setImmediate(resolve)))
        await destructible.promise
        assert(destructible.destroyed, 'destroyed')
    })
    it('can set a destructor', async () => {
        const destructible = new Destructible('main')
        destructible.durable('destructs', new Promise(resolve => destructible.destruct(resolve)))
        destructible.destroy()
        await destructible.promise
        assert(destructible.destroyed, 'destroyed')
    })
    it('cat create a destructor group', async () => {
        const test = []
        const destructible = new Destructible('main')
        const cleared = destructible.destructor()
        cleared.destruct(() => { throw new Error })
        cleared.clear()
        const destructor = destructible.destructor()
        cleared.destruct(() => test.push('destructed'))
        destructible.destroy()
        await destructible.promise
        assert.deepStrictEqual(test, [ 'destructed' ], 'destructed')
    })
    it('can gather return values', async () => {
        const destructible = new Destructible('main')
        const one = new Future
        destructible.durable([ 'path', 1 ], one.promise)
        one.resolve(null, 1)
        const two = new Future
        destructible.durable([ 'path', 2 ], two.promise)
        two.resolve(null, 2)
        assert.deepStrictEqual(await destructible.promise, { path: { 1: 1, 2: 2 } }, 'gathered')
    })
    it('can initialize from a block', async () => {
        const destructible = new Destructible('main')
        destructible.ephemeral('child', (destructible) => {
            const future = new Future
            destructible.durable('future', future.promise, () => future.resolve(null, 1))
        })
        destructible.destroy()
        assert.deepStrictEqual(await destructible.promise, { child: { future: 1 } }, 'block init')
    })
    it('can raise an error from a block', async () => {
        const test = []
        const destructible = new Destructible('main')
        try {
            destructible.ephemeral('child', (destructible) => {
                destructible.durable('destructs', new Promise(resolve => destructible.destruct(resolve)))
                throw new Error('failed')
            })
        } catch (error) {
            test.push(error.message)
        } finally {
            destructible.destroy()
        }
        await destructible.promise
        assert.deepStrictEqual(test, [ 'failed' ], 'test')
    })
    it('can raise an error from an async block', async () => {
        const test = []
        const destructible = new Destructible('main')
        try {
            await destructible.ephemeral('child', async (destructible) => {
                destructible.durable('destructs', new Promise(resolve => destructible.destruct(resolve)))
                throw new Error('failed')
            })
        } catch (error) {
            test.push(error.message)
        } finally {
            destructible.destroy()
        }
        await destructible.promise
    })
    it('can catch an error from a monitored promise', async () => {
        const test = []
        const destructible = new Destructible('main')
        destructible.durable('error', (async () => { throw new Error('thrown') })())
        try {
            await destructible.promise
        } catch (error) {
            console.log(error.stack)
            test.push(error.causes[0].message)
        } finally {
            destructible.destroy()
        }
        assert.deepStrictEqual(test, [ 'thrown' ], 'catch')
    })
    it('can destroy a destructible when a durable block completes', async () => {
        const destructible = new Destructible(10000, 'main')
        destructible.durable('parent', (destructible) => {
            destructible.durable('child', Promise.resolve(true))
        })
        await destructible.promise
    })
    it('can destroy a destructible when an ephemeral block errors', async () => {
        const test = []
        const destructible = new Destructible(10000, 'main')
        destructible.durable('parent', (destructible) => {
            destructible.ephemeral('child', Promise.reject(new Error('thrown')))
        })
        try {
            await destructible.promise
        } catch (error) {
            console.log(error.stack)
            test.push(error.causes[0].causes[0].message)
        }
        assert.deepStrictEqual(test, [ 'thrown' ], 'catch')
    })
    it('can catch destructor errors', async () => {
        const test = []
        const destructible = new Destructible(10000, 'main')
        destructible.destruct(() => { throw new Error('thrown') })
        destructible.destroy()
        try {
            await destructible.promise
        } catch (error) {
            console.log(error.stack)
            test.push(error.causes[0].message)
        }
        assert.deepStrictEqual(test, [ 'thrown' ], 'catch')
    })
    it('can scram', async () => {
        const test = []
        const destructible = new Destructible(50, 'main')
        let _resolve = null
        destructible.durable('unresolved', new Promise(resolve => _resolve = resolve))
        destructible.destroy()
        try {
            await destructible.promise
        } catch (error) {
            console.log(error.stack)
            test.push(error.label)
        }
        assert.deepStrictEqual(test, [ 'scrammed' ], 'catch')
        _resolve()
    })
    it('can scram a block', async () => {
        const test = []
        const destructible = new Destructible(50, 'main')
        let _resolve = null
        destructible.durable('parent', (destructible) => {
            destructible.durable('unresolved', new Promise(resolve => _resolve = resolve))
        })
        destructible.destroy()
        try {
            await destructible.promise
        } catch (error) {
            console.log(error.stack)
            test.push(/^scrammed$/m.test(error.causes[0].message))
        }
        assert.deepStrictEqual(test, [ true ], 'catch')
    })
    it('can set a timeout for an ephemeral block', async () => {
        const test = []
        const destructible = new Destructible('main')
        let _resolve = null
        destructible.ephemeral('parent', (destructible) => {
            destructible.durable('unresolved', new Promise(resolve => _resolve = resolve))
            destructible.destroy()
        }, 50)
        try {
            await destructible.promise
        } catch (error) {
            console.log(error.stack)
            test.push(/^scrammed$/m.test(error.causes[0].message))
        }
        assert.deepStrictEqual(test, [ true ], 'catch')
    })
    it('can return a sub-destructible', async () => {
        const test = []
        const destructible = new Destructible('main')
        const subDestructible = destructible.durable('child')
        subDestructible.destroy()
        assert.deepStrictEqual(await destructible.promise, { child: {} }, 'child')
    })
})
