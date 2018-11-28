// Return the first not null-like value.
var coalesce = require('extant')

// Generate a unique, canonical string key from a JSON object.
var Keyify = require('keyify')

// Contextualized callbacks and event handlers.
var operation = require('operation')

// Ever increasing serial integer with no maximum value.
var Monotonic = require('monotonic').asString

// Control-flow utilities.
var Signal = require('signal')
var cadence = require('cadence')
var abend = require('abend')

// Exceptions that you can catch by type.
var Interrupt = require('interrupt').createInterrupter('destructible')

// Unique id for each instance of destructible.
var INSTANCE = '0'

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
    this.key = coalesce(vargs.shift())

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

    this._completed = new Signal

    this.instance = INSTANCE = Monotonic.increment(INSTANCE, 0)
    this._destroyedAt = null
    this._index = 0
    this._vargs = []

}

Destructible.prototype._return = function (scrammed) {
    if (scrammed) {
        this.completed.unlatch(new Interrupt('hung', {
            causes: this._errors,
            destructible: this.key,
            waiting: this.waiting.slice(),
            context: this.context
        }))
    } else if (this._errors.length) {
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
                vargs.push.apply(vargs, this._vargs.shift())
            }
        }
        this.completed.unlatch.apply(this.completed, vargs)
    }
}

Destructible.prototype._countdown = cadence(function (async, timeout) {
    var timer
    async(function () {
        timer = setTimeout(function () {
            timer = null
            this.scram()
        }.bind(this), timeout - Math.max(Date.now() - this._destroyedAt, 0))
        this._completed.wait(async())
    }, function (scrammed) {
        if (timer != null) {
            clearTimeout(timer)
        }
        this._return(scrammed)
    })
})

Destructible.prototype._destroy = function (error, context) {
    if (error != null) {
        this._errors.push([ error, context ])
        this.errored.unlatch()
    }
    if (!this.destroyed) {
        this.destroyed = true
        // TODO Do not read time if we do not need it, countdown begins after
        // synchronous operations.
        this._destroyedAt = Date.now()
        try {
            this.destruct.unlatch()
        } catch (error) {
            // TODO We know the module, maybe we just have `upon: 'destruct`'.
            this._errors.push([ error, { module: 'destructible', method: 'destruct' } ])
        }
        if (this._complete()) {
            this._return(false)
        } else {
            this._countdown(this._timeout, abend)
        }
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

Destructible.prototype.destroy = function (error) {
    this._destroy(error, { module: 'destructible', method: 'destroy' })
}

Destructible.prototype.scram = function (error) {
    if (this._completed.open == null) {
        this._destroy(error, { module: 'destructible', method: 'scram' })
        // TODO Remove `scrammed`, just use `_completed` in children to chain
        // shutdown.
        this.scrammed.notify()
        this._completed.notify(null, true)
    }
}

Destructible.prototype.markDestroyed = function (object, property) {
    return this.destruct.wait(function () {
        object[coalesce(property, 'destroyed')] = true
    })
}

Destructible.prototype._fork = cadence(function (async, key, terminates, vargs) {
    var destructible = new Destructible(key)

    var destroy = this.destruct.wait(destructible, 'destroy')

    var scram = this.scrammed.wait(destructible, 'scram')

    if (terminates) {
        destructible.errored.wait(this, 'destroy')
    } else {
        destructible.destruct.wait(this, 'destroy')
    }

    destructible.destruct.wait(this, function () { this.destruct.cancel(destroy) })

    var monitor = this._monitor('destructible', !! terminates, [ key ])
    destructible.completed.wait(this, function (error) {
        this.scrammed.cancel(scram)
        monitor.apply(null, Array.prototype.slice.call(arguments))
    })
    var parent = this
    var unready = this.completed.wait(function () {
        unready = null
        destructible.destroy(new Interrupt('unready', {
            key: [ parent.key, destructible.key ]
        }))
    })
    async([function () {
        if (unready != null) {
            this.completed.cancel(unready)
        }
    }], function () {
        var f = operation.shift(vargs)
        vargs.push(async())
        vargs.unshift(destructible)
        async(function () {
            f.apply(null, vargs)
        }, [], function (vargs) {
            return vargs
        })
    })
})

Destructible.prototype._monitor = function (method, terminates, vargs) {
    var key = vargs.shift()
    if (vargs.length != 0) {
        var callback = vargs.pop()
        if (callback === null) {
            callback = this._monitor('constructor', true, [ key ])
        }
        if (this.destroyed) {
            callback(new Interrupt('destroyed', {
                keys: [ this.key, key ],
                waiting: this.waiting.slice(),
                context: this.context
            }))
        } else {
            this._fork(key, terminates, vargs, callback)
        }
    } else {
        var wait = { module: 'destructible', method: method, terminates: terminates, key: key }
        this.waiting.push(wait)
        if (! terminates) {
            var index = this._index++
        }
        return function (error) {
            if (! terminates) {
                this._vargs[index] = Array.prototype.slice.call(arguments, 1)
            }
            if (! terminates || error != null) {
                this._destroy(error, {
                    module: 'destructible',
                    method: method,
                    terminates: terminates,
                    key: key
                })
            }
            this.waiting.splice(this.waiting.indexOf(wait), 1)
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
Destructible.prototype.ephemeral = function () {
    var vargs = []
    vargs.push.apply(vargs, arguments)
    return this._monitor('monitor', true, vargs)
}

Destructible.prototype.durable = function () {
    var vargs = []
    vargs.push.apply(vargs, arguments)
    return this._monitor('monitor', false, vargs)
}

module.exports = Destructible
