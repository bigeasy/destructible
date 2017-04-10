require('proof')(15, require('cadence')(prove))

function prove (async, assert) {
    var Destructor = require('..')
    var destructor = new Destructor('named')
    assert(destructor.name, 'named', 'named')
    var destructor = new Destructor
    assert(destructor.name, null, 'no name')

    var object = { destroyed: false }

    destructor.markDestroyed(object, 'destroyed')
    destructor.addDestructor('destructor', function () {
        assert(true, 'destructor ran')
    })
    destructor.addDestructor('invoked', function () {
        assert(true, 'destructor invoked')
    })
    destructor.addDestructor('removed', function () {
        throw new Error('should not run')
    })
    destructor.invokeDestructor('invoked')
    destructor.removeDestructor('removed')
    assert(destructor.getDestructors(), [ 'destructor' ], 'removed')

    destructor.check()

    async([function () {
        destructor.destructible('a', function (callback) {
            destructor.destructible(function (callback) {
                callback(new Error('cause'))
            }, callback)
        }, async())
    }, function (error) {
        assert(error.message, 'cause', 'error thrown')
        assert(destructor.destroyed, true, 'destroyed')
        assert(object.destroyed, true, 'marked destroyed')

        try {
            destructor.check()
        } catch (error) {
            console.log(error.stack)
            assert(/^destructible#destroyed$/m.test(error.message), 'destroyed')
        }

        destructor.destroy()

        destructor.addDestructor('destroyed', function () {
            assert(true, 'run after destroyed')
        })

        destructor.destructible(function () {
            assert(false, 'should not be called')
        }, async())
    }], [function () {
        destructor = new Destructor
        destructor.async(async, 'a')(function () {
            destructor.async(async, 'b')(function () {
                throw new Error('cause')
            })
        })
    }, function (error) {
        assert(error.message, 'cause', 'async error thrown')
        assert(destructor.destroyed, true, 'async destroyed')
        assert(object.destroyed, true, 'async marked destroyed')

        try {
            destructor.check()
        } catch (error) {
            console.log(error.stack)
            assert(/^destructible#destroyed$/m.test(error.message), 'async check')
        }

        destructor.destroy()

        destructor.addDestructor('destroyed', function () {
            assert(true, 'async run after destroyed')
        })

        destructor.async(async, 'x')(function () {
            assert(false, 'should not be called')
        })
    }])
}
