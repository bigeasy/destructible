require('proof')(17, async (okay) => {
    const Destructible = require('..')
    {
        const destructible = new Destructible('main')
        destructible.destroy()
        okay(await destructible.destructed, {}, 'constructed')
        try {
            destructible.cause
        } catch (error) {
            okay('cause throws an error')
        }
    }
    {
        const destructible = new Destructible('main')
        destructible.durable('immediate', new Promise(resolve => setImmediate(resolve)))
        await destructible.destructed
        okay(destructible.destroyed, 'wait for durable promise')
    }
    {
        const destructible = new Destructible('main')
        destructible.durable('destructs', new Promise(resolve => destructible.destruct(resolve)))
        destructible.destroy()
        await destructible.destructed
        okay(destructible.destroyed, 'set destructor')
    }
    {
        const test = []
        const destructible = new Destructible('main')
        const cleared = destructible.destructor()
        cleared.destruct(() => { throw new Error })
        cleared.clear()
        const destructor = destructible.destructor()
        cleared.destruct(() => test.push('destructed'))
        destructible.destroy()
        await destructible.destructed
        okay(test, [ 'destructed' ], 'create a destructor group')
    }
    {
        const destructible = new Destructible('main')
        const future = {}
        const one = new Promise(resolve => future.one = resolve)
        destructible.durable([ 'path', 1 ], one)
        future.one.call(null, 1)
        const two = new Promise(resolve => future.two = resolve)
        destructible.durable([ 'path', 2 ], two)
        future.two.call(null, 2)
        okay(await destructible.destructed, { path: { 1: 1, 2: 2 } }, 'gather retrurn values')
    }
    {
        const destructible = new Destructible('main')
        const sub = destructible.ephemeral('child')
        const future = {}
        sub.durable('future', new Promise(resolve => future.resolve = resolve))
        sub.destruct(() => future.resolve.call(null, 1))
        destructible.destroy()
        okay(await destructible.destructed, {}, 'create sub-destructible')
    }
    {
        const destructible = new Destructible('main')
        const sub = destructible.ephemeral('child')
        sub.destroy()
        await sub.destructed
        destructible.destroy()
        okay(await destructible.destructed, {}, 'wait for sub-destructible to complete')
    }
    {
        const test = []
        const destructible = new Destructible('main')
        destructible.durable('error', (async () => { throw new Error('thrown') })())
        try {
            await destructible.destructed
        } catch (error) {
            console.log(error.stack)
            test.push(error.causes[0].message)
        } finally {
            destructible.destroy()
        }
        okay(test, [ 'thrown' ], 'catch error from monitored promise')
    }
    {
        const destructible = new Destructible(10000, 'main')
        const sub = destructible.durable('parent')
        sub.durable('child', Promise.resolve(true))
        await destructible.destructed
        okay(destructible.destroyed, 'destroy a destructible when a durable sub-destructible completes')
    }
    {
        const test = []
        const destructible = new Destructible(10000, 'main')
        const sub = destructible.durable('parent')
        sub.ephemeral('child', Promise.reject(new Error('thrown')))
        try {
            await destructible.destructed
        } catch (error) {
            console.log(error.stack)
            test.push(error.causes[0].causes[0].message)
        }
        okay(test, [ 'thrown' ], 'destroy a destructible when an ephemeral sub-destructible errors')
    }
    {
        const test = []
        const destructible = new Destructible(10000, 'main')
        destructible.destruct(() => { throw new Error('thrown') })
        destructible.destroy()
        try {
            await destructible.destructed
        } catch (error) {
            console.log(error.stack)
            test.push(error.causes[0].message)
        }
        okay(test, [ 'thrown' ], 'catch destructor error')
    }
    {
        const test = []
        const destructible = new Destructible(50, 'main')
        const latch = {}
        destructible.durable('unresolved', new Promise(resolve => latch.resolve = resolve))
        destructible.destroy()
        try {
            await destructible.destructed
        } catch (error) {
            console.log(error.stack)
            test.push(error.label)
        }
        okay(test, [ 'scrammed' ], 'scram')
        latch.resolve.call()
    }
    {
        const test = []
        const destructible = new Destructible(50, 'main')
        let _resolve = null
        const sub = destructible.durable('parent')
        sub.durable('unresolved', new Promise(resolve => _resolve = resolve))
        destructible.destroy()
        try {
            await destructible.destructed
        } catch (error) {
            console.log(error.stack)
            test.push(/^scrammed$/m.test(error.causes[0].message))
        }
        okay(test, [ true ], 'scram sub-destructible')
    }
    {
        const test = []
        const destructible = new Destructible('main')
        let _resolve = null
        const sub = destructible.ephemeral('parent', 50)
        sub.durable('unresolved', new Promise(resolve => _resolve = resolve))
        sub.destroy()
        try {
            await destructible.destructed
        } catch (error) {
            console.log(error.stack)
            test.push(/^scrammed$/m.test(error.causes[0].message))
        }
        okay(test, [ true ], 'set timeout for an ephemeral block')
    }
    {
        const test = []
        const destructible = new Destructible('main')
        destructible.increment()
        destructible.increment(2)
        destructible.decrement()
        destructible.decrement(2)
        await destructible.destructed
        okay(test, [], 'countdown to destruction')
    }
    {
        const test = []
        const destructible = new Destructible('function')
        destructible.durable('f', async () => 1)
        okay(await destructible.destructed, { f: 1 }, 'function')
    }
})
