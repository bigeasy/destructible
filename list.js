class List {
    constructor () {
        this._head = { next: null, previous: null, value: null }
        this._head.next = this._head.previous = this._head
    }

    *[Symbol.iterator] () {
        let iterator = this._head
        while (iterator.next !== this._head) {
            iterator = iterator.next
            yield iterator.value
        }
    }

    peek () {
        return this._head.next.value
    }

    slice () {
        const slice = []
        for (const value of this) {
            slice.push(value)
        }
        return slice
    }

    get empty () {
        return this._head.next === this._head
    }

    push (value) {
        const node = {
            next: this._head,
            previous: this._head.previous,
            value: value
        }
        node.previous.next = node
        node.next.previous = node
        return node
    }

    // Point to self so that future calls to unlink are a no-op.
    static unlink (node) {
        node.next.previous = node.previous
        node.previous.next = node.next
        node.next = node.previous = node
        return node.value
    }

    shift () {
        return List.unlink(this._head.next)
    }
}

module.exports = List
