"""Offline ZIP writer preserving captured file types, including npm bin links."""
import hashlib, json, pathlib, posixpath, stat, sys, zipfile

def sha(value): return hashlib.sha256(value).hexdigest()
def build(template, expected_sha, tree, map_path, destination):
    template=pathlib.Path(template); tree=pathlib.Path(tree); destination=pathlib.Path(destination)
    assert sha(template.read_bytes())==expected_sha and not destination.exists()
    expected=json.loads(pathlib.Path(map_path).read_text(encoding='utf-8'))
    metadata={}; directories=[]
    with zipfile.ZipFile(template) as original:
        for info in original.infolist():
            p=pathlib.PurePosixPath(info.filename)
            assert not p.is_absolute() and '..' not in p.parts and '\\' not in info.filename and ':' not in info.filename
            assert info.filename not in metadata
            metadata[info.filename]=info
            if info.is_dir(): directories.append(info.filename)
            elif stat.S_ISLNK(info.external_attr>>16):
                target=original.read(info).decode('utf-8')
                assert info.filename.startswith('node_modules/.bin/') and not target.startswith('/') and '\\' not in target and ':' not in target
                resolved=posixpath.normpath(posixpath.join(str(p.parent),target))
                assert resolved.startswith('node_modules/') and not resolved.startswith('node_modules/../')
                assert (tree/info.filename).read_bytes()==original.read(info)
            else: assert stat.S_IFMT(info.external_attr>>16) in [0,stat.S_IFREG]
    with zipfile.ZipFile(destination,'x',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as output:
        for name in sorted(set(directories)|set(expected)):
            source=metadata.get('index.js' if name=='business.js' else name)
            info=zipfile.ZipInfo(name,(1980,1,1,0,0,0)); info.compress_type=zipfile.ZIP_DEFLATED
            info.create_system=source.create_system if source else 3
            info.external_attr=source.external_attr if source else 0o100644<<16
            content=b'' if name in directories else (tree/name).read_bytes()
            if name not in directories: assert sha(content)==expected[name]
            output.writestr(info,content,compresslevel=9)
    links=[]
    with zipfile.ZipFile(destination) as output:
        assert {i.filename:sha(output.read(i)) for i in output.infolist() if not i.is_dir()}==expected
        for name,source in metadata.items():
            if stat.S_ISLNK(source.external_attr>>16):
                copied=output.getinfo(name)
                assert copied.external_attr==source.external_attr and copied.create_system==source.create_system
                links.append(name)
    assert sha(template.read_bytes())==expected_sha
    return {'zip_sha256':sha(destination.read_bytes()),'preserved_symlinks':sorted(links)}

if __name__=='__main__':
    assert len(sys.argv)==6
    print(json.dumps(build(*sys.argv[1:])))
