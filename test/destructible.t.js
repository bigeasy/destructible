require('proof')(36, async (okay) => {
    const Destructible = require('..')
    {
        const destructible = new Destructible('main')
        destructible.destroy()
        okay(!await destructible.rejected, 'constructed')
        okay(await destructible.destructed, 'destructed')
        try {
            destructible.cause
        } catch (error) {
            okay('cause throws an error')
        }
    }
    {
        const destructible = new Destructible('main')
        destructible.durable('immediate', new Promise(resolve => setImmediate(resolve)))
        await destructible.rejected
        okay(destructible.destroyed, 'wait for durable promise')
    }
    {
        const destructible = new Destructible('main')
        destructible.durable('destructs', new Promise(resolve => {
            console.log('called!!!')
            destructible.destruct(resolve)
        }))
        destructible.destroy()
        await destructible.rejected
        okay(destructible.destroyed, 'set destructor')
    }
    {
        const test = []
        const destructible = new Destructible('main')
        const destructors = []
        destructors.push(destructible.destruct(() => { throw new Error }))
        destructible.destruct(() => test.push('destructed'))
        destructors.push(destructible.destruct(() => { throw new Error }))
        destructible.clear(destructors)
        destructible.destroy()
        await destructible.rejected
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
        await destructible.rejected
        okay(await results, { one: 1, two: 2 }, 'gather retrurn values')
    }
    {
        const destructible = new Destructible('main')
        const sub = destructible.ephemeral('child')
        const future = {}
        sub.durable('future', new Promise(resolve => future.resolve = resolve))
        sub.destruct(() => future.resolve.call(null, 1))
        destructible.destroy()
        okay(!await destructible.rejected, 'create sub-destructible')
    }
    {
        const destructible = new Destructible('main')
        const sub = destructible.ephemeral('child')
        const subsub = sub.durable('child')
        subsub.destroy()
        await sub.rejected
        okay(!destructible.destroyed, 'not destroyed')
        destructible.destroy()
        okay(!await destructible.rejected, 'wait for sub-destructible to complete')
    }
    {
        const test = []
        const destructible = new Destructible('main')
        destructible.durable('error', (async () => { throw new Error('thrown') })())
        try {
            await destructible.rejected
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
        await destructible.rejected
        okay(destructible.destroyed, 'destroy a destructible when a durable sub-destructible completes')
    }
    {
        const test = []
        const destructible = new Destructible(10000, 'main')
        const sub = destructible.durable('parent')
        sub.ephemeral('child', Promise.reject(new Error('thrown')))
        try {
            await destructible.rejected
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
            await destructible.rejected
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
            await destructible.rejected
        } catch (error) {
            console.log(error.stack)
            test.push(error.label)
        }
        okay(test, [ 'scrammed' ], 'scram')
        latch.resolve.call()
    }
    {
        const test = []
        const destructible = new Destructible(50, 'parent')
        let _resolve = null
        const sub = destructible.durable('child')
        sub.durable('unresolved', new Promise(resolve => _resolve = resolve))
        destructible.destroy()
        try {
            console.log('here')
            await destructible.rejected
            console.log('there')
        } catch (error) {
            console.log(error.stack)
            test.push(/^scrammed$/m.test(error.causes[0].message))
        }
        okay(test, [ true ], 'scram sub-destructible')
        _resolve()
    }
    {
        const test = []
        const destructible = new Destructible(50, 'main')
        let _resolve = null
        const sub = destructible.ephemeral('parent')
        sub.durable('unresolved', new Promise(resolve => _resolve = resolve))
        sub.destroy()
        try {
            await destructible.rejected
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
        await destructible.rejected
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
            }, true)
        } catch (error) {
            console.log(error)
            okay(error instanceof Destructible.Error, 'attempt did init error')
            console.log(error.stack)
        }
        try {
            await destructible.rejected
        } catch (error) {
            console.log(error.stack)
        }
    }
    {
        const destructible = new Destructible('attempt')
        await Destructible.rescue(Promise.resolve(true))
    }
    {
        const destructible = new Destructible('attempt')
        Destructible.rescue(async function () {
            await destructible.ephemeral('name', async function () {
                throw new Error('error')
            }, true)
        })
        try {
            await destructible.rejected
        } catch (error) {
            console.log(error.stack)
        }
    }
    {
        const destructible = new Destructible('attempt')
        Destructible.rescue(async function () {
            try {
            await destructible.ephemeral('name', async function () {
                throw new Error('error')
            }, true)
            } catch (error) {
                console.log(error)
            }
        })
        try {
            await destructible.rejected
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
        await destructible.rejected
        okay('cleanup')
    }
    {
        const test = []
        const destructible = new Destructible('destroyed')
        destructible.destroy()
        try {
            destructible.ephemeral('destroyed')
        } catch (error) {
            test.push(error instanceof Destructible.Error)
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
        await destructible.rejected
    }
    {
        const destructible = new Destructible('main')
        const child = destructible.durable('child')
        child.increment()
        destructible.destroy()
        okay(destructible.destroyed, 'parent destroyed')
        okay(!child.destroyed, 'child not yet destroyed')
        child.decrement()
        okay(child.destroyed, 'child destroyed')
        await destructible.rejected
    }
    {
        const test = []
        try {
            Destructible.destroyed(new Error('error'))
        } catch (error) {
            test.push(error.message)
        }
        okay(test, [ 'error' ], 'unrescuable')
    }
    {
        const test = []
        const destructible = new Destructible(50, 'main')
        const child = destructible.ephemeral('child')
        child.increment()
        destructible.destroy()
        await destructible.rejected
        okay('delayed child scrammed')
    }
    {
        const destructible = new Destructible('main')
        destructible.destruct(() => {
            destructible.ephemeral('shutdown', () => {})
        })
        destructible.destroy()
        await destructible.destroyed
        okay('async destroyed')
    }
    {
        const destructible = new Destructible('main')
        await destructible.drain()
        const latch = { resolve: null }
        destructible.durable('first', new Promise(resolve => latch.resolve = resolve))
        destructible.ephemeral('second', new Promise(resolve => setTimeout(resolve, 150)))
        destructible.ephemeral('third', new Promise(resolve => setTimeout(resolve, 150)))
        const promises = []
        promises.push(destructible.drain())
        promises.push(destructible.drain())
        for (const promise of promises) {
            await promise
        }
        latch.resolve()
        await destructible.rejected
        okay('drain')
    }
    {
        const test = []
        const destructible = new Destructible('main')
        destructible.operable++
        const child = destructible.durable('child')
        okay(child.operable, 1, 'child inherits operable')
        destructible.operable++
        okay(child.operable, 2, 'child operable set')
        destructible.destruct(() => test.push('destroyed'))
        destructible.close(() => test.push('closed'))
        const handle = destructible.close(() => test.push('should not see'))
        destructible.close(() => { throw new Error('errored') })
        destructible.operational()
        destructible.destroy()
        okay(test, [ 'destroyed' ], 'only destroyed')
        okay(!destructible.inoperable, 'still operable')
        destructible.operational()
        destructible.clear(handle)
        destructible.operable--
        destructible.operable--
        okay(test, [ 'destroyed', 'closed' ], 'destroyed and closed')
        destructible.operable++
        okay(destructible.inoperable, 'inoperable')
        try {
            await destructible.rejected
        } catch (error) {
            test.push(error.causes[0].message)
        }
        okay(test, [ 'destroyed', 'closed', 'errored' ], 'destroyed and closed and errored')
    }
})
