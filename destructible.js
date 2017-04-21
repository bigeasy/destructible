var cadence = require('cadence')
var nop = require('nop')
var coalesce = require('extant')
var Keyify = require('keyify')
var Operation = require('operation/variadic')
var Procession = require('procession')
var Monotonic = require('monotonic').asString
var INSTANCE = '0'
var Signal = require('signal')
var interrupt = require('interrupt').createInterrupter()

function Destructible (key) {
    this.destroyed = false
    this.errors = []
    this.interrupts = []
    this.events = new Procession
    this.key = coalesce(key)
    this._destructors = {}
    this._waiting = []
    this._instance = INSTANCE = Monotonic.increment(INSTANCE, 0)
    this._readyInstance = 0
    this.ready = new Signal
    this.ready.unlatch()
    this.ready.instance = ++this._readyInstance
}

Destructible.prototype._destroy = function (key, error) {
    if (error != null) {
        this.errors.push(error)
        this.interrupts.push(interrupt({ key: key }, error))
    }
    if (!this.destroyed) {
        this._stackWhenDestroyed = new Error().stack
        this.events.push({
            module: 'destructible',
            method: 'destroyed',
            from: this._instance,
            body: {
                destructible: this.key,
                waiting: this._waiting.slice(),
                cause: this.cause
            }
        })
        this.destroyed = true
        for (var key in this._destructors) {
            console.log(key)
            this._destructors[key].call()
        }
        this._destructors = null
    }
}

Destructible.prototype.destroy = function () {
    this._destroy()
}

Destructible.prototype.markDestroyed = function (object, property) {
    this.addDestructor('markDestroyed', function () {
        object[coalesce(property, 'destroyed')] = true
    })
}

Destructible.prototype.addDestructor = function (key) {
    key = Keyify.stringify(key)
    var operation = Operation(Array.prototype.slice.call(arguments, 1))
    if (this.destroyed) {
        operation()
    } else {
        this._destructors[key] = operation
    }
}

Destructible.prototype.invokeDestructor = function (key) {
    key = Keyify.stringify(key)
    interrupt.assert(this._destructors != null, 'invokeDestroyed', this.cause, {
        stack: this._stackWhenDestroyed,
        when: this.when,
        destroyed: this.destroyed
    })
    var destructor = this._destructors[key]
    destructor()
    delete this._destructors[key]
}

Destructible.prototype.removeDestructor = function (key) {
    key = Keyify.stringify(key)
    delete this._destructors[key]
}

Destructible.prototype.getDestructors = function () {
    return Object.keys(this._destructors).map(function (key) {
        return Keyify.parse(key)
    })
}

function _asyncIf (async, destructible, ready, vargs) {
    async(function () {
        ready.wait(async())
    }, function () {
        if (!destructible.destroyed) {
            async.apply(null, vargs)
        }
    })
}

function _async (destructible, async, key) {
    if (destructible.destroyed) {
        return function () {}
    }
    var previous = destructible.ready
    var ready = destructible.ready = new Signal
    destructible.ready.instance = ++destructible._readyInstance
    return function () {
        var vargs = Array.prototype.slice.call(arguments)
        var waiting = { destructor: key }
        destructible._waiting.push(waiting)
        async([function () {
            destructible._destroy(key)
            destructible._waiting.splice(destructible._waiting.indexOf(waiting), 1)
            destructible.events.push({
                module: 'destructible',
                method: 'popped',
                from: destructible._instance,
                body: {
                    destructible: destructible.key,
                    destructor: key,
                    waiting: destructible._waiting.slice(),
                    cause: destructible.cause
                }
            })
        }], [function () {
            _asyncIf(async, destructible, previous, [ function () { return [ ready ] } ].concat(vargs))
        }, function (error) {
            destructible._destroy(key, error)
            ready.unlatch()
            throw error
        }])
    }
}

Destructible.prototype._stack = cadence(function (async, vargs) {
    _async(this, async, vargs.shift())(function (ready) {
        Operation(vargs)(ready, async())
    })

})

Destructible.prototype.stack = function () {
    var vargs = Array.prototype.slice.call(arguments)
    if (typeof vargs[0] == 'function') {
        return _async(this, vargs[0], vargs[1])
    } else {
        this._stack(vargs, vargs.pop())
    }
}

function _rescue (destructible, async, key) {
    if (destructible.destroyed) {
        // TODO Maybe propagate errors?
        return function () {}
    }
    return function () {
        var vargs = Array.prototype.slice.call(arguments)
        var ready = destructible.ready
        async([function () {
            _asyncIf(async, destructible, ready, vargs)
        }, function (error) {
            destructible._destroy(key, error)
            throw error
        }])
    }
}

Destructible.prototype._rescue = cadence(function (async, key, vargs) {
    _rescue(this, async, key)(function () { Operation(vargs)(async()) })
})

Destructible.prototype.rescue = function () {
    var vargs = Array.prototype.slice.call(arguments)
    if (typeof vargs[0] == 'function') {
        return _rescue(this, vargs[0], vargs[1])
    }
    if (vargs.length == 1) {
        return function (error) { if (error) this._destroy(vargs[0], error) }.bind(this)
    }
    this._rescue(vargs.shift(), vargs, vargs.pop())
}

module.exports = Destructible
