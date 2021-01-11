require('proof')(42, async (okay) => {
    const rescue = require('rescue')
    const Destructible = require('..')
    {
        const destructible = new Destructible('main')
        destructible.destroy()
        await destructible.promise
        await destructible.done
        try {
            destructible.cause
        } catch (error) {
            okay('cause throws an error')
        }
    }
    {
        const destructible = new Destructible('main')
        destructible.durable('destructs', new Promise(resolve => {
            destructible.destruct(resolve)
        }))
        destructible.destroy()
        await destructible.promise
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
        await destructible.promise
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
        destructible.destroy()
        future.two.call(null, 2)
        future.one.call(null, 1)
        await destructible.promise
        okay(await results, { one: 1, two: 2 }, 'gather retrurn values')
    }
    {
        const destructible = new Destructible('main')
        const sub = destructible.ephemeral('child')
        const future = {}
        sub.durable('future', new Promise(resolve => future.resolve = resolve))
        sub.destruct(() => future.resolve.call(null, 1))
        destructible.destroy()
        okay(!await destructible.promise, 'create sub-destructible')
    }
    {
        const destructible = new Destructible('main')
        const sub = destructible.ephemeral('child')
        const subsub = sub.ephemeral('child')
        subsub.destroy()
        await subsub.promise
        okay(!destructible.destroyed, 'not destroyed')
        destructible.destroy()
        okay(!await destructible.promise, 'wait for sub-destructible to complete')
    }
    {
        const fs = require('fs').promises
        const test = []
        const destructible = new Destructible($ => $(), 'main')
        destructible.durable($ => $(), 'error', async function () {
            await new Promise(resolve => setTimeout(resolve, 0))
            throw new Error('thrown')
        })
        try {
            await destructible.promise
        } catch (error) {
            console.log(error.stack)
            test.push(error.errors[0].errors[0].message)
        } finally {
            destructible.destroy()
        }
        okay(test, [ 'thrown' ], 'catch error from monitored promise')
    }
    {
        const test = []
        const destructible = new Destructible($ => $(), 10000, 'main')
        const sub = destructible.durable($ => $(), 'parent')
        sub.ephemeral($ => $(), 'child', Promise.reject(new Error('thrown')))
        try {
            await destructible.promise
        } catch (error) {
            console.log(error.stack)
            test.push(error.errors[0].errors[0].errors[0].message)
        }
        okay(test, [ 'thrown' ], 'destroy a destructible when an ephemeral sub-destructible errors')
    }
    {
        const test = []
        const destructible = new Destructible(10000, 'main')
        destructible.destruct(() => { throw new Error('thrown') })
        destructible.destroy()
        try {
            await destructible.promise
        } catch (error) {
            console.log(error.stack)
            test.push(error.errors[0].errors[0].message)
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
            await destructible.promise
        } catch (error) {
            console.log(error.stack)
            test.push(error.code)
        }
        okay(test, [ 'SCRAMMED' ], 'scram')
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
            await destructible.promise
            console.log('there')
        } catch (error) {
            console.log(error.stack)
            test.push(error.errors[0].code)
        }
        okay(test, [ 'SCRAMMED' ], 'scram sub-destructible')
        _resolve()
    }
    {
        const test = []
        const destructible = new Destructible('main')
        destructible.increment()
        destructible.increment()
        destructible.decrement()
        destructible.decrement()
        destructible.decrement()
        await destructible.promise
        okay(test, [], 'countdown to destruction')
    }
    {
        const test = []
        const destructible = new Destructible('function')
        const result = await destructible.ephemeral('f', async () => 1)
        okay(result, 1, 'function')
        await destructible.destroy().promise
    }
    {
        const destructible = new Destructible('attempt')
        try {
            await destructible.exceptional('name', async function () {
                throw new Error('error')
            })
        } catch (error) {
            console.log(error)
            okay(error instanceof Destructible.Error, 'attempt did init error')
            console.log(error.stack)
        }
        try {
            await destructible.promise
        } catch (error) {
            console.log(error.stack)
        }
    }
    {
        const destructible = new Destructible('attempt')
        const promise = destructible.rescue('setup', async function () {
            return 1
        })
        destructible.destroy()
        try {
            await destructible.promise
        } catch (error) {
            console.log(error.stack)
        }
        okay(await promise, 1, 'instance rescue')
    }
    {
        const destructible = new Destructible('attempt')
        await destructible.rescue(async function () {
            destructible.destroy()
            destructible.durable('failure', async () => {})
        })
        destructible.destroy()
        try {
            await destructible.promise
        } catch (error) {
            console.log(error.stack)
        }
    }
    {
        const destructible = new Destructible('attempt')
        try {
            await destructible.rescue('setup', async function () {
                throw new Error('hello')
            })
        } catch (error) {
            okay(destructible.destroyed, 'auto destroyed')
            okay(error.message, 'hello', 'rescue rethrew non-destructible error')
            await destructible.promise
        }
    }
    {
        const destructible = new Destructible(250, 'progress')
        const child = destructible.ephemeral('child')
        child.progress()
        child.durable('progress', async function () {
            let count = 7
            while (--count != 0) {
                await new Promise(resolve => setTimeout(resolve, 100))
                if (count % 2 == 0) {
                    destructible.progress()
                } else {
                    child.progress()
                }
            }
            destructible.destroy()
        })
        await destructible.promise
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
        const terminal = destructible.durable('one', one.promise)
        const ephemeral = destructible.ephemeral('two')
        ephemeral.destroy()
        await new Promise(resolve => setImmediate(resolve))
        destructible.destroy()
        one.resolve()
        await destructible.promise
    }
    {
        const destructible = new Destructible('main')
        const child = destructible.durable('child', { countdown: 0 })
        child.increment()
        destructible.destroy()
        okay(destructible.destroyed, 'parent destroyed')
        okay(!child.destroyed, 'child not yet destroyed')
        child.decrement()
        okay(child.destroyed, 'child destroyed')
        await destructible.promise
    }
    {
        const test = []
        const destructible = new Destructible(50, 'main')
        const child = destructible.ephemeral('child', { countdown: 2 })
        destructible.destroy()
        try {
            await destructible.promise
        } catch (error) {
            rescue(error, [{ code: 'SCRAMMED' }])
            okay('delayed child scrammed')
        }
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
        okay(destructible.drain(), null, 'nothing to drain')
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
        destructible.destroy()
        latch.resolve()
        await destructible.promise
        okay('drain')
    }
    {
        const destructible = new Destructible('redurable')
        destructible.durable('early exit', async () => {})
        const test = []
        try {
            await destructible.promise
        } catch (error) {
            test.push(error.errors[0].code)
        }
        okay(test, [ 'DURABLE' ], 'exited too early')
    }
    {
        const destructible = new Destructible('redurable')
        const latch = { resolve: null }
        destructible.durable('resolve', new Promise(resolve => latch.resolve = resolve))
        destructible.destroy()
        latch.resolve.call()
        await destructible.promise
    }
    {
        const destructible = new Destructible('redurable')
        const latch = { resolve: null }
        destructible.durable('resolve', async () => { throw new Error('thrown') })
        const test = []
        try {
            await destructible.promise
        } catch (error) {
            test.push(error.errors[0].errors[0].message)
        }
        okay(test, [ 'thrown' ], 'durable reports an early exit due to exception with the exception')
    }
    {
        const destructible = new Destructible('destructive')
        okay(await destructible.destructive('sync', async () => 1), 1, 'destructive async')
        okay(await destructible.destructive($ => $(), 'async', Promise.resolve(1)), 1, 'destructive promise')
        okay(destructible.destructive($ => $(), 'sync', () => 1), 1, 'destructive sync')
        await destructible.destroy().promise
    }
    {
        const destructible = new Destructible('destructive')
        try {
            destructible.destructive($ => $(), 'sync', () => { throw new Error })
        } catch (error) {
            okay(error instanceof Destructible.Error, 'sync destructive throw')
        }
        try {
            await destructible.promise
        } catch (error) {
            okay(error.errors.length, 1, 'sync destructive throw funneled')
        }
    }
    {
        const destructible = new Destructible('destructive')
        okay(destructible.destructive($ => $(), 'sync', null, () => { throw new Error }), null, 'sync destructive returned')
        try {
            await destructible.promise
        } catch (error) {
            okay(error.errors.length, 1, 'sync destructive returned funneled')
        }
    }
    {
        const destructible = new Destructible('destructive')
        okay(await destructible.destructive($ => $(), 'async', null, async () => { throw new Error }), null, 'async destructive returned')
        try {
            await destructible.promise
        } catch (error) {
            okay(error.errors.length, 1, 'async destructive returned funneled')
        }
    }
    {
        const destructible = new Destructible('destructive')
        okay(destructible.copacetic('copacetic', () => 1), 1, 'copacetic not errored')
        await destructible.ephemeral('errored', async () => { throw new Error })
        okay(destructible.copacetic('copacetic', null, () => 1), null, 'copacetic errored error return')
        let ran = false
        destructible.copacetic('copacetic', () => ran = true)
        okay(! ran, 'copacetic errored no op')
        try {
            await destructible.promise
        } catch (error) {
            okay(error.errors.length, 1, 'async destructive returned funneled')
        }
    }
})
