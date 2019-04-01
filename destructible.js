var assert = require('assert')

// Contextualized callbacks and event handlers.
var operation = require('operation')

// Control-flow utilities.
var Signal = require('signal')
var cadence = require('cadence')

// Exceptions that you can catch by type.
var Interrupt = require('interrupt').createInterrupter('destructible')

// Construct a destructable that will track callbacks and timeout if they are
// not all invoked within a certain time frame when destroy is called.

//
function Destructible () {
    var vargs = []
    vargs.push.apply(vargs, arguments)

    // By default, we wait a full second for all outstanding callbacks to
    // return.
    this._timeout = typeof vargs[0] == 'number' ? vargs.shift() : 1000

    // Displayed when we timeout.
    this.key = vargs.shift()

    this.context = vargs

    // Errors returned to callbacks.
    this._errors = []

    // Set immediately upon destruction. Will be true if inspected by any of the
    // destructors registered with `destruct` or `scrammed`.
    this.destroyed = false

    // You're welcome to dump this list of waiting callbacks if it helps you
    // with debugging.
    this.waiting = []

    // Listen to know when to shut down.
    this.destruct = new Signal

    // Listen to know the moment we get an error, but not to get the error.
    this.errored = new Signal

    // Listen to know when we're done.
    this.completed = new Signal

    // Listen to know if we've forcibly shutdown before all callbacks have
    // returned.
    this.scrammed = new Signal

    // Internal completion signal.
    this._completed = new Signal

    this._vargs = []

    this._runScramTimer = true
}

Destructible.prototype._return = function () {
    if (this.waiting.length !== 0) {
        console.log('YES SCRAM', this.key)
        this.completed.unlatch(new Interrupt('scrammed', {
            causes: this._errors,
            destructible: this.key,
            waiting: this.waiting.slice(),
            context: this.context
        }))
    } else if (this._errors.length !== 0) {
        this.completed.unlatch(new Interrupt('error', {
            causes: this._errors,
            key: this.key,
            waiting: this.waiting.slice(),
            context: this.context
        }))
    } else {
        // TODO Where am I actually using return value?
        var vargs = []
        if (this._vargs.length) {
            vargs.push(null)
            while (this._vargs.length) {
                this._vargs[0].shift()
                vargs.push.apply(vargs, this._vargs.shift())
            }
        }
        this.completed.unlatch.apply(this.completed, vargs)
    }
}

Destructible.prototype._destroy = function (error, context) {
    if (this.cause == null) {
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
    if (error != null) {
        console.log('DESTRUCTIBLE ERROR')
        this._errors.push([ error, context ])
        this.errored.unlatch()
    }
    if (!this.destroyed) {
        this.destroyed = true
        try {
            this.destruct.unlatch()
        } catch (error) {
            // TODO We know the module, maybe we just have `upon: 'destruct`'.
            this._errors.push([ error, { module: 'destructible', method: 'destruct' } ])
        }
        if (this._complete()) {
            this._return()
        } else {
            // Bind scram now so that we mark ourselves completed as the last
            // scram action, all our children can report their scrams first.
            this.scrammed.wait(this._completed, 'unlatch')
            // Run a timer if we're at the root of an ephemeral destructible.
            // TODO Do not run timer if our parent is destroyed, only if we're
            // shutting down in isolation.
            var timer = null
            if (this._runScramTimer) {
                console.log('SET SCRAM TIMER', this.key)
                timer = setTimeout(this.scrammed.unlatch.bind(this.scrammed), this._timeout)
            }
            this._completed.wait(this, function () {
                if (timer != null) {
                    console.log('CLEAR SCRAM TIMER', this.key)
                    clearTimeout(timer)
                }
                this._return()
            })
        }
    }
}

Destructible.prototype.drain = function () {
    this.draining = true
    this._drained()
    this._complete()
}

Destructible.prototype._drained = function () {
    if (this.draining && this.waiting.length == 0) {
        this.destroy()
    }
}

Destructible.prototype._complete = function () {
    if (this.destroyed && this.waiting.length == 0 && this._completed.open == null) {
        this._completed.unlatch(null, false)
        return true
    } else {
        return false
    }
}

Destructible.prototype.destroy = function () {
    assert(arguments.length == 0) // We used to accept a final error, but no.
    this._destroy(null, { module: 'destructible', method: 'destroy' })
}

Destructible.prototype._monitor = function (method, ephemeral, forgivable, vargs) {
    var key = vargs.shift()
    if (vargs.length != 0) {
        var callback = vargs.pop()
        if (callback === null) {
            callback = this._monitor('constructor', true, false, [ key ])
        }
        if (this.destroyed) {
            callback(new Interrupt('destroyed', {
                keys: [ this.key, key ],
                waiting: this.waiting.slice(),
                context: this.context
            }))
        } else {
            // Create a callback to give to the new stack.
            var monitor = this._monitor('destructible', ephemeral, forgivable, [ key ])

            // Create a destructible to monitor the stack.
            var destructible = new Destructible(key)

            // Destory the child destructible when we're destroyed.
            var destroy = this.destruct.wait(destructible, 'destroy')

            // Scram the child destructible when we're scrammed.
            var scram = this.scrammed.wait(destructible.scrammed, 'unlatch')

            // If the child is ephemeral then we'll destory ourselves only if it
            // errors, otherwise we'll destroy ourself if it is destroyed.
            if (ephemeral) {
                if (!forgivable) {
                    destructible.errored.wait(this, 'destroy')
                }
            } else {
                destructible.destruct.wait(this, function () {
                    this._destroy(null, {
                        module: 'destructible',
                        method: 'destruct',
                        key: key,
                        cause: destructible.cause,
                        ephemeral: false
                    })
                })
                destructible._runScramTimer = false
            }

            // When we are destroyed we unregister parent to child destruction
            // notification.
            destructible.destruct.wait(this, function () { this.destruct.cancel(destroy) })

            // When we've completed we unregister parent to child scram
            // notification and return our results to the destructible callback.
            destructible.completed.wait(this, function () {
                this.scrammed.cancel(scram)
                monitor.apply(null, arguments)
            })

            // So… Like Turnstile, any error coming out of Destructible should
            // be a fatal error that ends the program. Same reasons. Hard to
            // handle the stange meta error is the one reason, but here and
            // elsewhere there's the reason that we may be timing you out,
            // you're not getting an error related to your call, but a meta
            // error from Destructible saying that your call did not complete.
            // We're giving you this error to unwind your stack, you should not
            // recover from it.
            //
            // This is the way and it might be the rule that tidies up all this
            // hanging and removes the duplications. You have your real errors
            // and these scrammed and hung messages are there to tell you about
            // other places that hit a dead end. You'll probably be able to
            // infer some of the reasons for the dead ends from the callbacks.
            //
            // We fussed with this in so many ways. You even wrote a module that
            // would perform some dirty logic to from the first callback that
            // returns. Let's round up all that nonsense into this one place.
            //
            var constructed = new Signal

            // Call our callback with a response passed via a latch.
            constructed.wait(callback)

            // We bury our return and raise this exception.
            var unready = destructible.scrammed.wait(this, function () {
                constructed.unlatch(new Interrupt('scrammed', {
                    module: 'destructible',
                    method: 'constructor',
                    ephemeral: ephemeral,
                    parentKey: this.key,
                    key: key
                }))
            })

            // This will let our destruction process know we're waiting on a
            // consturctor to turn-the-corner.
            destructible.waiting.push({
                module: 'destructible',
                method: 'constructor',
                ephemeral: ephemeral,
                parentKey: this.key,
                key: key
            })

            // Unless, of course, everything goes according to plan. We use
            // Cadence here for the conversion of exceptions to errors.
            cadence(function (async) {
                async([function () {
                    destructible.scrammed.cancel(unready)
                    destructible.waiting.shift()
                    destructible._drained()
                    destructible._complete()
                }], function () {
                    var f = operation.shift(vargs)
                    vargs.unshift(destructible)
                    vargs.push(async())
                    f.apply(null, vargs)
                })
            })(constructed.unlatch.bind(constructed))
        }
    } else {
        var wait
        this.waiting.push(wait = {
            module: 'destructible',
            method: method,
            ephemeral:
            ephemeral,
            key: key
        })
        if (! ephemeral) {
            var index = this._vargs.length
            this._vargs.push([])
        }
        return function (error) {
            if (! ephemeral) {
                this._vargs[index].push.apply(this._vargs[index], arguments)
            }
            if (! ephemeral || (error != null && ! forgivable)) {
                this._destroy(error, {
                    module: 'destructible',
                    method: method,
                    ephemeral: ephemeral,
                    key: key
                })
            }
            this.waiting.splice(this.waiting.indexOf(wait), 1)
            this._drained()
            this._complete()
        }.bind(this)
    }
}

// Thinking that maybe, unlike other error-first callbacks in my arena, this one
// should assert that we're still open and fail immediately. We're going to
// assume that we're using Cadence, so it is going to propagate. We can then
// look for destroyed monitor exceptions and rescue them.
//
// We can come back and reevaluate our Cadence assumption, but I'm not sure I
// want to use Destructible without Cadence. I don't want to use Node.js without
// Cadence.
//
Destructible.prototype.durable = function () {
    var vargs = []
    vargs.push.apply(vargs, arguments)
    return this._monitor('monitor', false, false, vargs)
}

Destructible.prototype.ephemeral = function () {
    var vargs = []
    vargs.push.apply(vargs, arguments)
    return this._monitor('monitor', true, false, vargs)
}

// Hard to find a word that means semi-disconnected. Independent? The purpose is
// to tie the child to the shutdown mechanisms, but to avoid propagating its
// errors so that they do not appear in in the tree. We assume that the errors
// will be rejoin the tree at some other point. Probably only useful as a child
// destructible and not a callback.
//
// Errors do not cause the parent to destruct, nor do errors get reported in the
// parent, however if the parent is destroyed the child will be destroyed and
// the child's scram will be canceled and the parent will countdown to scram and
// scram the child if necessary.

//
Destructible.prototype.forgivable = function () {
    var vargs = []
    vargs.push.apply(vargs, arguments)
    return this._monitor('monitor', true, true, vargs)
}

module.exports = Destructible
