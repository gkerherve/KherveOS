"""sip stand-in: nothing is ever deleted from under Python here."""


def isdeleted(obj):
    return False


def delete(obj):
    pass


def wrapinstance(addr, cls):
    return cls()


def unwrapinstance(obj):
    return id(obj)


def setapi(*a):
    pass


def transferto(*a):
    pass


def transferback(*a):
    pass


def cast(obj, cls):
    return obj


SIP_VERSION_STR = "4.19 (KherveOS shim)"
