require('proof/redux')(1, prove)

function prove (assert) {
    assert(require('..'), 'required')
}
