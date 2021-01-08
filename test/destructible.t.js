require('proof')(32, async (okay) => {
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
        destructible.terminal('immediate', new Promise(resolve => setImmediate(resolve)))
        await destructible.promise
        okay(destructible.destroyed, 'wait for terminal promise')
    }
    {
        const destructible = new Destructible('main')
        destructible.terminal('destructs', new Promise(resolve => {
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
            one: destructible.terminal([ 'path', 1 ], one),
            two: destructible.terminal([ 'path', 2 ], two),
        })
        await new Promise(resolve => setTimeout(resolve, 50))
        future.two.call(null, 2)
        future.one.call(null, 1)
        await destructible.promise
        okay(await results, { one: 1, two: 2 }, 'gather retrurn values')
    }
    {
        const destructible = new Destructible('main')
        const sub = destructible.ephemeral('child')
        const future = {}
        sub.terminal('future', new Promise(resolve => future.resolve = resolve))
        sub.destruct(() => future.resolve.call(null, 1))
        destructible.destroy()
        okay(!await destructible.promise, 'create sub-destructible')
    }
    {
        const destructible = new Destructible('main')
        const sub = destructible.ephemeral('child')
        const subsub = sub.terminal('child')
        subsub.destroy()
        await sub.promise
        okay(!destructible.destroyed, 'not destroyed')
        destructible.destroy()
        okay(!await destructible.promise, 'wait for sub-destructible to complete')
    }
    {
        const fs = require('fs').promises
        const test = []
        const destructible = new Destructible($ => $(), 'main')
        destructible.terminal($ => $(), 'error', async function () {
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
        const destructible = new Destructible(10000, 'main')
        const sub = destructible.terminal('parent')
        sub.terminal('child', Promise.resolve(true))
        await destructible.promise
        okay(destructible.destroyed, 'destroy a destructible when a terminal sub-destructible completes')
    }
    {
        const test = []
        const destructible = new Destructible($ => $(), 10000, 'main')
        const sub = destructible.terminal($ => $(), 'parent')
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
        destructible.terminal('unresolved', new Promise(resolve => latch.resolve = resolve))
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
        const sub = destructible.terminal('child')
        sub.terminal('unresolved', new Promise(resolve => _resolve = resolve))
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
        const destructible = new Destructible(50, 'main')
        let _resolve = null
        const sub = destructible.ephemeral('parent')
        sub.terminal('unresolved', new Promise(resolve => _resolve = resolve))
        sub.destroy()
        try {
            await destructible.promise
        } catch (error) {
            console.log(error.stack)
            test.push(error.errors[0].code)
        }
        okay(test, [ 'SCRAMMED' ], 'set timeout for an ephemeral block')
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
        const result = await destructible.terminal('f', async () => 1)
        okay(result, 1, 'function')
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
        await Destructible.rescue(Promise.resolve(true))
    }
    {
        const destructible = new Destructible('attempt')
        Destructible.rescue(async function () {
            await destructible.ephemeral('name', async function () {
                throw new Error('error')
            })
            await new Promise(resolve => setImmediate(resolve))
            await destructible.ephemeral('name', async function () {
            })
        })
        try {
            await destructible.promise
        } catch (error) {
            const caught = rescue(error, [ 'error' ]).errors.shift()
            okay(caught.message, 'error', 'intialization halted by a shutdown')
        }
    }
    {
        const destructible = new Destructible('attempt')
        Destructible.rescue(async function () {
            try {
                await destructible.ephemeral('name', async function () {
                    throw new Error('error')
                })
            } catch (error) {
                console.log(error)
            }
        })
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
        const destructible = new Destructible(250, 'progress')
        const child = destructible.ephemeral('child')
        child.progress()
        child.terminal('progress', async function () {
            let count = 7
            while (--count != 0) {
                await new Promise(resolve => setTimeout(resolve, 100))
                if (count % 2 == 0) {
                    destructible.progress()
                } else {
                    child.progress()
                }
            }
        })
        destructible.destroy()
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
        const terminal = destructible.terminal('one', one.promise)
        const ephemeral = destructible.ephemeral('two')
        ephemeral.destroy()
        await new Promise(resolve => setImmediate(resolve))
        one.resolve()
        await destructible.promise
    }
    {
        const destructible = new Destructible('main')
        const child = destructible.terminal('child', { countdown: 0 })
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
        destructible.terminal('first', new Promise(resolve => latch.resolve = resolve))
        destructible.ephemeral('second', new Promise(resolve => setTimeout(resolve, 150)))
        destructible.ephemeral('third', new Promise(resolve => setTimeout(resolve, 150)))
        const promises = []
        promises.push(destructible.drain())
        promises.push(destructible.drain())
        for (const promise of promises) {
            await promise
        }
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
    }
})
