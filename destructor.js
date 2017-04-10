var cadence = require('cadence')
var coalesce = require('extant')
var Keyify = require('keyify')
var interrupt = require('interrupt').createInterrupter('destructible')
var Operation = require('operation/variadic')
var slice = [].slice
var Procession = require('procession')
var Monotonic = require('monotonic').asString
var INSTANCE = '0'

function Destructor (name) {
    this.destroyed = false
    this.cause = null
    this.events = new Procession

    var vargs = slice.call(arguments)

    this.name = typeof vargs[0] == 'string' ? vargs.shift() : null
    this._destructors = {}
    this._markers = []
    this._waiting = []
    this._instance = INSTANCE = Monotonic.increment(INSTANCE, 0)
}

Destructor.prototype.destroy = function (error) {
    if (error) {
        this.check()
        this.cause = error
    }
    if (!this.destroyed) {
        this._stack = new Error().stack
        this.events.push({
            module: 'destructible',
            method: 'destroyed',
            from: this._instance,
            body: {
                destructor: this.name,
                waiting: this._waiting.slice(),
                cause: this.cause
            }
        })
        this.destroyed = true
        for (var name in this._destructors) {
            this._destructors[name].apply([])
        }
        this._destructors = null
        this._markers.forEach(function (f) { f() })
        this._markers = null
    }
}

Destructor.prototype.markDestroyed = function (object, property) {
    this._markers.push(function () { object[property] = true })
}

Destructor.prototype.addDestructor = function (key) {
    key = Keyify.stringify(key)
    var operation = Operation(slice.call(arguments, 1))
    if (this.destroyed) {
        operation()
    } else {
        this._destructors[key] = operation
    }
}

Destructor.prototype.invokeDestructor = function (key) {
    key = Keyify.stringify(key)
    if (this._destructors == null) {
        console.log({
            cause: this.cause && this.cause.stack,
            stack: this._stack,
            when: this.when,
            destroyed: this.destroyed
        })
    }
    var destructor = this._destructors[key]
    destructor()
    delete this._destructors[key]
}

Destructor.prototype.removeDestructor = function (key) {
    key = Keyify.stringify(key)
    delete this._destructors[key]
}

Destructor.prototype.getDestructors = function () {
    return Object.keys(this._destructors).map(function (key) {
        return Keyify.parse(key)
    })
}

Destructor.prototype.check = function () {
    if (this.destroyed) {
        throw interrupt('destroyed', {}, { cause: coalesce(this.cause) })
    }
}

Destructor.prototype.destructible = cadence(function (async) {
    if (!this.destroyed) {
        var vargs = slice.call(arguments, 1)
        var name = typeof vargs[0] == 'string' ? vargs.shift() : null
        var waiting = { destructible: name }
        this._waiting.push(waiting)
        async([function () {
            this.destroy()
            this._waiting.splice(this._waiting.indexOf(waiting), 1)
            this.events.push({
                module: 'destructible',
                method: 'popped',
                from: this._instance,
                body: {
                    destructor: this.name,
                    destructible: name,
                    waiting: this._waiting.slice(),
                    cause: this.cause
                }
            })
        }], [function () {
            Operation(vargs)(async())
        }, function (error) {
            if (!this.destroyed) {
                this.destroy(error)
            }
            throw error
        }])
    }
})

Destructor.prototype.async = function (async, name) {
    var destructor = this
    if (destructor.destroyed) {
        return function () {}
    }
    return function () {
        var vargs = slice.call(arguments)
        var waiting = { destructible: name }
        destructor._waiting.push(waiting)
        async([function () {
            destructor.destroy()
            destructor._waiting.splice(destructor._waiting.indexOf(waiting), 1)
            destructor.events.push({
                module: 'destructible',
                method: 'popped',
                from: destructor._instance,
                body: {
                    destructor: destructor.name,
                    destructible: name,
                    waiting: destructor._waiting.slice(),
                    cause: destructor.cause
                }
            })
        }], [function () {
            async.apply(null, vargs)
        }, function (error) {
            if (!destructor.destroyed) {
                destructor.destroy(error)
            }
            throw error
        }])
    }
}

module.exports = Destructor
