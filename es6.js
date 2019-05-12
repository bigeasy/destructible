const delay = require('delay')
const Latch = require('signal/latch')
const Future = require('signal/future')

class Destructible {
    constructor (...vargs) {
        this._timeout = typeof vargs[0] == 'number' ? vargs.shift() : 1000
        this.key = vargs.shift()
        this.context = vargs

        this.destroyed = false
        this.waiting = []

        this._errors = []

        this._destructors = []
        this._errored = new Latch
        this._expired = new Latch
        this._completed = new Future

        this._results = {}

        this._scramTimer = { clear: () => {} }
    }

    get promise () {
        return this._completed.promise
    }

    destruct (f) {
        if (!~this._destructors.indexOf(f)) {
            this._destructors.push(f)
        }
        return f
    }

    cancel (f) {
        const index = this._destructors.indexOf(f)
        if (~index) {
            return this._destructors.splice(index, 1).shift()
        }
        return null
    }

    _return () {
        if (this.waiting.length != 0) {
            this._completed.resolve(new Interrupt('scrammed', {
                causes: this._errors,
                destructible: this.key,
                waiting: this.waiting.slice(),
                context: this.context
            }))
        } else if (this._errors.length != 0) {
            this._completed.resolve(new Interrupt('error', {
                causes: this._errors,
                key: this.key,
                waiting: this.waiting.slice(),
                context: this.context
            }))
        } else {
            this._completed.resolve(null, this._results)
        }
    }

    async _destroy (error) {
        if (this.cuause == null) {
            this.cause = {
                module: 'destructible',
                method: context.method,
                ephemeral: context.ephemeral || null,
                key: this.key,
                monitorKey: context.key || null,
                cause: context.cause || null,
                stack: error ? error.stack : null
            }
        }
        if (!this.destroyed) {
            this.destroyed = true
            while (this._destructors.length != 0) {
                try {
                    const result = this._destructors.shift().call(null)
                    if (result instanceof Promise) {
                        await result
                    }
                } catch (error) {
                    console.log(error.stack)
                }
            }
            if (this._complete()) {
                this._return()
            } else {
                if (this._timeout != Infinity) {
                    this._expired.await(() => this._scramTimer.clear())
                    await (this._scramTimer = delay(this._timeout))
                    this._expired.unlatch()
                } else {
                    const future = new Future
                    this._expired.await(future.resolve.bind(future))
                    await future.promise
                }
                this._return()
            }
       }
    }

    destroy () {
        this._destroy(null, { module: 'destructible', method: 'destroy' })
    }

    _complete () {
        if (this.destroyed && this.waiting.length == 0) {
            this._expired.unlatch()
            return true
        } else {
            return false
        }
    }

    _setResult (key, result) {
        if (result !== (void(0))) {
            if (Array.isArray(key)) {
                let iterator = this._results
                const path = key.slice()
                while (path.length != 1) {
                    if (!(path[0] in iterator)) {
                        iterator[path[0]] = {}
                    }
                    iterator = iterator[path[0]]
                    path.shift()
                }
                iterator[path[0]] = result
            } else {
                this._results[key] = result
            }
        }
    }

    async _await (ephemeral, method, key, operation) {
        const wait = { module: 'destructible', method, ephemeral, key }
        this.waiting.push(wait)
        try {
            try {
                this._setResult(key, await operation)
            } finally {
                this.waiting.splice(this.waiting.indexOf(wait), 1)
            }
            if (!ephemeral) {
                this._destroy(null, context)
            }
        } catch (error) {
            this._destroy(error, context)
        } finally {
            this._complete()
        }
    }

    async _awaitBlock (destructible, ephemeral, key, promise) {
        // Add a waiting entry for the initialization block. If we expire
        // before the block completes the blcok wait will be reported in a
        // scram type error.
        const wait = {
            module: 'destructible',
            method: 'block',
            ephemeral: ephemeral,
            parentKey: this.key,
            key: key
        }
        destructible.waiting.push(wait)
        try {
            await promise
        } catch (error) {
            // User will have a copy.
        } finally {
            destructible.waiting.splice(destructible.waiting.indexOf(wait), 1)
            destructible._complete()
        }
    }

    _monitor (ephemeral, vargs) {
        // Ephemeral destructible children can set a scram timeout.
        const timeout = ephemeral && typeof vargs[0] == 'number' ? vargs.shift() : Infinity
        const key = vargs.shift()
        const operation = vargs.shift()
        if (operation instanceof Promise) {
            this._await(ephemeral, 'promise', key, operation)
            if (vargs.length != 0) {
                return this.destruct(vargs.shift())
            }
        } else {
            // Create the child destructible.
            const destructible = new Destructible(timeout, key)

            // Destroy the child destructible when we are destroyed.
            const destruct = this.destruct(() => destructible.destroy())
            destructible.destruct(() => this.cancel(destruct))

            // If the child is ephemeral, only destory the parent on error,
            // otherwise, destroy the parent when the child is destroyed.
            if (ephemeral) {
                destructible._errored.await(() => this._destroy(null, { key, ephemeral }))
            } else {
                destructible.destruct(() => this.destroy_(null, { key, ephemeral }))
            }

            // Scram the child destructible if we are scrammed.
            const scram = this._expired.await(() => destructible._expired.unlatch())
            destructible._expired.await(() => this._expired.cancel(scram))

            // Monitor our new destructible as child of this destructible.
            this._await(ephemeral, 'block', key, destructible.promise)

            // Run the initialization block and then remove our waiting entry
            // and check for completion.
            const result = operation.call(null, destructible)
            if (result instanceof Promise) {
                this._awaitBlock(destructible, ephemeral, key, result)
            }
            return result
        }
    }

    // Monitor an operation that lasts the lifetime of the `Destructible`. When
    // the promise resolves or rejects we perform an orderly shutdown of the
    // `Destructible`.
    durable (...vargs) {
        return this._monitor(false, vargs)
    }

    // Monitor an operation that does not  last the lifetime of the
    // `Destructible`. Only when the promise rejects do we perform an orderly
    // shutdown of the `Destructible`.
    ephemeral (...vargs) {
        return this._monitor(true, vargs)
    }
}

module.exports = Destructible
