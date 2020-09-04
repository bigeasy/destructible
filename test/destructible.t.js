require('proof')(22, async (okay) => {
    const Destructible = require('..')
    {
        const destructible = new Destructible('main')
        destructible.destroy()
        okay(await destructible.destructed, 'constructed')
        try {
            destructible.cause
        } catch (error) {
            okay('cause throws an error')
        }
    }
    {
        const destructible = new Destructible('main')
        destructible.durable('immediate', new Promise(resolve => setImmediate(resolve)))
        console.log('here')
        await destructible.destructed
        console.log('there')
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
        const two = new Promise(resolve => future.two = resolve)
        async function get (object) {
            for (const name in object) {
                object[name] = await object[name]
            }
            return object
        }
        const results = get({
            one: destructible.durable([ 'path', 1 ], one),
            two: destructible.durable([ 'path', 2 ], two),
        })
        await new Promise(resolve => setTimeout(resolve, 50))
        future.two.call(null, 2)
        future.one.call(null, 1)
        await destructible.destructed
        okay(await results, { one: 1, two: 2 }, 'gather retrurn values')
    }
    {
        const destructible = new Destructible('main')
        const sub = destructible.ephemeral('child')
        const future = {}
        sub.durable('future', new Promise(resolve => future.resolve = resolve))
        sub.destruct(() => future.resolve.call(null, 1))
        destructible.destroy()
        okay(await destructible.destructed, 'create sub-destructible')
    }
    {
        const destructible = new Destructible('main')
        const sub = destructible.ephemeral('child')
        const subsub = sub.durable('child')
        subsub.destroy()
        await sub.destructed
        okay(!destructible.destroyed, 'not destroyed')
        destructible.destroy()
        okay(await destructible.destructed, 'wait for sub-destructible to complete')
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
        const destructible = new Destructible(50, 'main')
        let _resolve = null
        const sub = destructible.ephemeral('parent')
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
        const result = await destructible.durable('f', async () => 1)
        okay(result, 1, 'function')
    }
    {
        const destructible = new Destructible('attempt')
        try {
            await destructible.ephemeral('name', async function () {
                throw new Error('error')
            }, Destructible.Rescuable, 'open')
        } catch (error) {
            okay(error instanceof Destructible.Rescuable, 'attempt did init error')
            console.log(error.stack)
            okay(error.causes[0].message, 'error', 'attempt nested init error')
        }
        try {
            await destructible.destructed
        } catch (error) {
            console.log(error.stack)
        }
    }
    {
        const destructible = new Destructible('attempt')
        Destructible.rescue(async function () {
            await destructible.ephemeral('name', async function () {
                throw new Error('error')
            }, Destructible.Rescuable)
        })
        try {
            await destructible.destructed
        } catch (error) {
            console.log(error.stack)
        }
    }
    {
        const destructible = new Destructible(250, 'working')
        const child = destructible.ephemeral('child')
        child.working()
        child.durable('working', async function () {
            let count = 7
            while (--count != 0) {
                await new Promise(resolve => setTimeout(resolve, 100))
                if (count % 2 == 0) {
                    destructible.working()
                } else {
                    child.working()
                }
            }
        })
        destructible.destroy()
        await destructible.destructed
        okay('cleanup')
    }
    {
        const test = []
        const destructible = new Destructible('destroyed')
        destructible.destroy()
        try {
            destructible.ephemeral('destroyed')
        } catch (error) {
            test.push(error instanceof Destructible.Rescuable)
        }
        okay(test, [ true ], 'destroyed')
    }
    {
        const destructible = new Destructible('remove scram')
        const one = {}
        one.promise = new Promise(resolve => one.resolve = resolve)
        const durable = destructible.durable('one', one.promise)
        const ephemeral = destructible.ephemeral('two')
        ephemeral.destroy()
        await new Promise(resolve => setImmediate(resolve))
        one.resolve()
        await destructible.destructed
    }
})
